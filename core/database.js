//MySQL数据库驱动
const express = require('express');
const mysql = require('mysql');
const app = express();



console.log("~ 探测数据库IP：" + _config.mysql.host);
console.log("~ [数据库] 正在连接到数据库服务器：" + _config.mysql.host);
let pool = null;

function createPool() {
    pool = mysql.createPool({
        host: _config.mysql.host,
        user: _config.mysql.user,
        password: _config.mysql.password,
        database: _config.mysql.database
    });
}

function closePool() {
    if (pool) {
        pool.end(function (err) {
            if (err) {
                console.error('[数据库] 断开连接时发生错误: ' + err.stack);
                return;
            }
            console.log('[数据库] 已成功断开连接');
            pool = null;
        });
    }
}

exports.query = function (sql, params) {
    return new Promise((resolve, reject) => {
        if (!pool) {
            reject(new Error('[数据库] 请先初始化连接池'));
            return;
        }
        pool.getConnection((err, connection) => {
            if (err) {
                reject(err);
                return;
            }
            connection.query(sql, params, (err, results) => {
                connection.release();
                if (err) {
                    reject(err);
                    return;
                }
                resolve(results);
            });
        });
    });
};

exports.createPool = createPool;
exports.closePool = closePool;
