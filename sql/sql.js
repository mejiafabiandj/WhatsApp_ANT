require('dotenv').config();

var Connection = require('tedious').Connection;
var Request = require('tedious').Request;
var TYPES = require('tedious').TYPES;

var connection;

function initDB() {
    return new Promise((resolve, reject) => {

        if (!connection) {
            var config = {
                server: process.env.MSSQL_SERVER,
                authentication: {
                    type: 'default',
                    options: {
                        userName: process.env.MSSQL_USER,
                        password: process.env.MSSQL_PWD
                    }
                },
                options: {
                    trustServerCertificate: true,
                    database: process.env.MSSQL_DB
                }
            };
            connection = new Connection(config);

            connection.on('connect', function (err) {
                // If no error, then good to proceed.
                if (err) {
                    console.log('Error: ', err);
                    reject(err);
                } else {
                    console.log("Successful connection");
                    resolve();
                }
            });

            connection.connect();
        }
    });
}



module.exports = {
    initDB
};