const fs = require('fs');
const path = require('path');
const express = require('express');

class PluginManager {
    constructor() {
        this.plugins = new Map();
        this.routes = new Map();
        this._routeStacks = new Map();
    }

    loadRoutes(pluginDir, app) {
        try {
            if (!fs.existsSync(pluginDir)) {
                console.log('~ [PluginManager] 插件目录不存在，正在创建...');
                fs.mkdirSync(pluginDir, { recursive: true });
                return;
            }

            const files = fs.readdirSync(pluginDir);
            
            files.forEach(file => {
                if (file.endsWith('.js')) {
                    const pluginPath = path.join(pluginDir, file);
                    this.loadPlugin(pluginPath, app);
                }
            });
        } catch (error) {
            console.error('~ [PluginManager] 加载插件时出错:', error);
        }
    }

    loadPlugin(pluginPath, app) {
        try {
            // 清除缓存以确保重新加载最新版本
            delete require.cache[require.resolve(pluginPath)];
            const plugin = require(pluginPath);
            
            const pluginName = path.basename(pluginPath, '.js');
            
            // 先移除旧路由（如果存在）
            this.removePluginRoutes(app, pluginName);

            // 存储插件信息
            this.plugins.set(pluginName, {
                name: pluginName,
                path: pluginPath,
                enabled: true,
                instance: plugin,
                description: plugin.plugin_info?.description || '暂无描述',
                version: plugin.plugin_info?.version || '1.0.0',
                category: plugin.plugin_info?.category || '未分类',
                author: plugin.plugin_info?.author || '未知'
            });

            // 如果插件已启用，处理路由
            if (this.plugins.get(pluginName).enabled) {
                const router = express.Router();
                
                try {
                    if (typeof plugin === 'function') {
                        // 旧版格式：将函数包装为路由处理器
                        const handler = plugin;
                        // 创建一个专用的子路由来处理请求
                        const subRouter = express.Router();
                        subRouter.all('*', (req, res, next) => {
                            try {
                                handler(req, res, next);
                            } catch (err) {
                                next(err);
                            }
                        });
                        
                        // 将子路由挂载到主路由
                        router.use('/', subRouter);
                        app.use('/', router);
                        this.routes.set(pluginName, subRouter);
                        console.log(`~ [PluginManager] 已加载旧版插件: ${pluginName}`);
                    } else if (typeof plugin.route === 'function') {
                        // 新版格式：使用route方法
                        const subRouter = express.Router();
                        try {
                            plugin.route(subRouter);
                            router.use('/', subRouter);
                            app.use('/', router);
                            this.routes.set(pluginName, subRouter);
                            console.log(`~ [PluginManager] 已加载新版插件: ${pluginName}`);
                        } catch (err) {
                            throw new Error(`插件 ${pluginName} 的route方法执行失败: ${err.message}`);
                        }
                    } else {
                        throw new Error(`插件 ${pluginName} 未提供有效的路由处理函数`);
                    }

                    // 保存路由堆栈引用
                    if (router.stack && router.stack.length > 0) {
                        this._routeStacks.set(pluginName, router.stack);
                    }
                } catch (routeError) {
                    console.error(`~ [PluginManager] 注册路由时出错: ${routeError.message}`);
                    throw routeError;
                }
            }
        } catch (error) {
            console.error(`~ [PluginManager] 加载插件 ${path.basename(pluginPath)} 时出错:`, error);
            // 确保出错时清理相关状态
            this.removePluginRoutes(app, path.basename(pluginPath));
        }
    }

    removePluginRoutes(app, pluginName) {
        try {
            if (app && app._router && app._router.stack) {
                // 查找并移除特定插件的路由
                app._router.stack = app._router.stack.filter(layer => {
                    const keepLayer = !(layer.name === pluginName || 
                        (layer.regexp && layer.regexp.toString().includes(pluginName)) ||
                        (layer.handle && layer.handle.name === pluginName));
                    return keepLayer;
                });
            }
            
            this._routeStacks.delete(pluginName);
            this.routes.delete(pluginName);
            console.log(`~ [PluginManager] 已移除插件路由: ${pluginName}`);
        } catch (error) {
            console.error(`~ [PluginManager] 移除插件路由时出错:`, error);
        }
    }

    reloadRoute(filePath, app) {
        const pluginName = path.basename(filePath, '.js');
        try {
            // 如果插件之前已加载，先移除旧路由
            if (this.routes.has(pluginName)) {
                console.log(`~ [PluginManager] 正在重新加载插件: ${pluginName}`);
            }
            
            this.loadPlugin(filePath, app);
        } catch (error) {
            console.error(`~ [PluginManager] 重新加载插件 ${pluginName} 时出错:`, error);
        }
    }

    setPluginState(name, enabled) {
        const plugin = this.plugins.get(name);
        if (!plugin) {
            console.error(`~ [PluginManager] 未找到插件: ${name}`);
            return null;
        }

        plugin.enabled = enabled;
        
        // 重新加载插件以应用新状态
        if (enabled) {
            this.loadPlugin(plugin.path, require('../index.js').app);
        } else {
            this.removePluginRoutes(require('../index.js').app, name);
        }
        
        console.log(`~ [PluginManager] 插件 ${name} ${enabled ? '已启用' : '已停用'}`);
        
        return {
            name: plugin.name,
            enabled: plugin.enabled,
            path: plugin.path,
            description: plugin.description || '暂无描述',
            version: plugin.version || '1.0.0',
            category: plugin.category || '未分类'
        };
    }

    getPlugins() {
        return Array.from(this.plugins.values()).map(plugin => ({
            name: plugin.name,
            path: plugin.path,
            enabled: plugin.enabled,
            description: plugin.description || '暂无描述',
            version: plugin.version || '1.0.0',
            category: plugin.category || '未分类'
        }));
    }

    // 添加 getPluginByPath 方法
    getPluginByPath(requestPath) {
        // 规范化请求路径
        requestPath = requestPath.toLowerCase();
        if (!requestPath.startsWith('/')) {
            requestPath = '/' + requestPath;
        }

        // 查找匹配的插件
        return Array.from(this.plugins.values()).find(plugin => {
            // 使用插件名称作为基础路径
            const pluginBasePath = '/' + plugin.name.toLowerCase();
            
            // 检查请求路径是否以插件名称开头
            return requestPath.startsWith(pluginBasePath + '/') || 
                   requestPath === pluginBasePath;
        });
    }
}

module.exports = new PluginManager();
