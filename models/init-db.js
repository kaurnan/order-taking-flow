// lib/mongo-connect.js
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");

dotenv.config(); // Load .env variables (e.g., MONGO_URI)

let client;

async function connectMongo() {
    if (!client) {
        client = new MongoClient(process.env.MONGO_URI);
        await client.connect();
        console.log("✅ MongoDB connected (native driver)");
    }

    return client.db(); // returns default DB from connection string
}

module.exports = { connectMongo };