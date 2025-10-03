const mongoose = require("mongoose");

const getDefaultTime = (hours, minutes = 0) => {
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;
};

const defaultStartTime = getDefaultTime(9, 0);
const defaultEndTime = getDefaultTime(18, 0);

const daySchema = {
    stime: { type: Date, default: defaultStartTime },
    etime: { type: Date, default: defaultEndTime },
    enabled: { type: Boolean, default: true },
};

const BusinessHoursSchema = new mongoose.Schema({
    org_id: { type: mongoose.Schema.Types.ObjectId, ref: "organisations", unique: true },
    quick_reply: { type: mongoose.Schema.Types.ObjectId, ref: "quickreplies", unique: true },
    bussiness_hours: {
        mon: { ...daySchema },
        tue: { ...daySchema },
        wed: { ...daySchema },
        thur: { ...daySchema },
        fri: { ...daySchema },
        sat: {
            stime: { type: Date, default: defaultStartTime },
            etime: { type: Date, default: defaultEndTime },
            enabled: { type: Boolean, default: false },
        },
        sun: {
            stime: { type: Date, default: defaultStartTime },
            etime: { type: Date, default: defaultEndTime },
            enabled: { type: Boolean, default: false },
        },
    },
    greetingmsg_enabled: { type: Boolean, default: false },
    awaymsg_enabled: { type: Boolean, default: false },
    awaymsg: {
        type: String,
        default: "Hi! We're currently unavailable but will get back to you as soon as possible. Feel free to leave your message!"
    },
    greetingmsg: {
        type: String,
        default: "Hi there! 😊 Thanks for reaching out. How can we assist you today?"
    },
});

const BusinessHours = mongoose.model("businesshours", BusinessHoursSchema);

module.exports = BusinessHours;