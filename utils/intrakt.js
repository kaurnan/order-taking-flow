const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

/**
 * Function to send a POST request to the Interakt API.
 * @param {string} token - Your authorization token.
 * @param {string} wabaId - Your WABA ID.
 * @param {string} solutionId - Your solution ID.
 * @param {string} phoneNumber - Optional phone number (if applicable).
 */
async function InteraktTPsignup(wabaId, phoneNumber) {
    const url = "https://api.interakt.ai/v1/organizations/tp-signup/";
    const headers = {
        "Authorization": process.env.INTERAKT_TOKEN
    };

    const data = {
        entry: [
            {
                changes: [
                    {
                        value: {
                            event: "PARTNER_ADDED",
                            waba_info: {
                                waba_id: wabaId,
                                solution_id: process.env.INTERAKT_SOLUTION_ID,
                                phone_number: phoneNumber,
                            },
                        },
                    },
                ],
            },
        ],
        object: "tech_partner",
    };

    try {
        return axios.post(url, data, { headers });
    } catch (error) {
        console.error("Error:", error.response ? error.response.data : error.message);
        return null;
    }
}

module.exports = InteraktTPsignup;