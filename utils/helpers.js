
const Organisation = require("../models/ums/organisation.model");
const TwentyFourHourWindowModel = require("../models/24hwindow.model");
const argon2 = require("argon2");
const { OAuth2Client } = require("google-auth-library");
const axios = require("axios");
const jwt = require("jsonwebtoken");

require("dotenv").config();

const oAuth2Client = new OAuth2Client(process.env.G_OAuthClientID, process.env.G_OAuthClientSecret, "postmessage");

async function IsValidOrganisationToSendMessage(organisation, branch_id) {
    if (!organisation || organisation.gupshup?.apps.length === 0) {
        return { status: false, message: "No App added on BSP, Please contact FlowFlex support team" };
    }

    if (!branch_id) {
        return { status: false, message: "Branch ID is required" };
    }

    const branch = await Brnaches.findById(branch_id);
    if (!branch || branch.status !== "Active") {
        return { status: false, message: "Branch is not active or not found, please make a valid plan for branches" };
    }

    if (!organisation.wallet || !organisation.wallet.balance || organisation.wallet.balance <= 0) {
        return { status: false, message: "Insufficient balance in the wallet" };
    }

    return { status: true, message: "Valid Organisation" };
}


async function verifyGoogleLoginToken(access_token) {
    try {
        const { tokens } = await oAuth2Client.getToken(access_token);
        const ticket = await oAuth2Client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.G_OAuthClientID,
        });
        const payload = ticket.getPayload();
        return payload;
    } catch (error) {
        console.log(error);
        throw { message: "Invalid login token", code: "400" };
    }
}


/**
 * Verify facebook token and get user info
 * @param access_token
 * @param user_id
 * @returns user info
 */
async function verifyFacebookToken(access_token, user_id) {
    const { data } = await generateFacebookaccessToken();
    if (data?.access_token) {
        const verification = await axios.get(`https://graph.facebook.com/debug_token?input_token=${access_token}&access_token=${data.access_token}`);
        if (verification.data && verification.data?.data.is_valid) {
            const userifo = await getFacebookUserInfo(access_token, user_id);
            return userifo?.data;
        } else {
            throw { message: "Invalid facebook token", code: "400" };
        }
    } else {
        throw { message: "Invalid facebook token", code: "400" };
    }
}

/**
 * Get user info from facebook
 * @param access_token
 * @param user_id
 * @returns
 */
async function getFacebookUserInfo(access_token, user_id) {
    try {
        return axios.get(`https://graph.facebook.com/${user_id}?fields=id,name,email&access_token=${access_token}`);
    } catch (error) {
        throw new Error(`Error getting facebook user info: ${error}`);
    }
}

/**
 * Get server to server token from facebook
 * @param {*} code 
 * @returns 
 */
async function Server_to_server_token(code) {
    return await axios.get(`https://graph.facebook.com/v20.0/oauth/access_token?client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}&code=${code}`);
}

/**
 * Generate facebook access token
 * @returns
 */
async function generateFacebookaccessToken() {
    try {
        return axios.get(`https://graph.facebook.com/v20.0/oauth/access_token?client_id=${process.env.FACEBOOK_APP_ID_FOR_LOGIN}&client_secret=${process.env.FACEBOOK_APP_SECRET_FOR_LOGIN}&grant_type=client_credentials`);
    } catch (error) {
        console.error(error);
        throw new Error("Error while generateFacebook accessToken");
    }
}

async function hashPassword(password) {
    try {
        const hash = await argon2.hash(password);
        return hash;
    } catch (err) {
        throw Error(`hash Error: ${err}`);
    }
}

function generateTokens(user) {
    const accessToken = jwt.sign(
        { _id: user._id, org_id: user.org_id, ttl: user.ttl, scopes: user.scopes || [] },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
    );
    const refreshTokenExpiry = user.ttl == 30 ? "30d" : "1d"; // 30 days if rememberMe, otherwise 1 day
    const refreshToken = jwt.sign(
        { _id: user._id, org_id: user.org_id, scopes: user.scopes },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: refreshTokenExpiry }
    );
    // Store the refresh token in the database or cache
    return { accessToken, refreshToken };
}

function reformatTemplatePayload(input) {
    const { template_json: { name, language, components = [] } } = input;
    console.log("input", input)
    const out = { name, language, components: [] };
    console.log(out)

    // HEADER → transform to parameters form if valid
    const header = components.find((c) => c.type === "HEADER");
    if (header) {
        // If header is already in correct format, use it directly
        if (
            Array.isArray(header.parameters) &&
            header.parameters.length > 0 &&
            typeof header.parameters[0] === "object" &&
            header.parameters[0].type &&
            header.parameters[0][header.parameters[0].type] &&
            header.parameters[0][header.parameters[0].type].link
        ) {
            out.components.push({
                type: "HEADER",
                parameters: header.parameters,
            });
        } else {
            const format = (header.format || "").toLowerCase();
            const supported = new Set(["image", "video", "document", "audio"]);
            if (supported.has(format)) {
                const link =
                    (header.example?.header_handle &&
                        header.example.header_handle[0]) ||
                    undefined;

                if (link) {
                    out.components.push({
                        type: "HEADER",
                        parameters: [
                            {
                                type: format,
                                [format]: { link },
                            },
                        ],
                    });
                }
            }
        }
    }

    // BODY → keep only if non-empty parameters
    const body = components.find((c) => c.type === "BODY");
    if (body?.parameters?.length > 0) {
        out.components.push({ type: "BODY", parameters: body.parameters });
    }

    // BUTTONS → keep only if there’s at least one valid button with non-empty parameters
    const buttons = components.find((c) => c.type === "BUTTONS");
    if (buttons?.buttons?.length > 0) {
        const validButtons = buttons.buttons.filter(
            (b) => Array.isArray(b.parameters) && b.parameters.length > 0
        );

        if (validButtons.length > 0) {
            out.components.push({ type: "BUTTONS", buttons: validButtons });
        }
    }

    return { ...input, template_json: out };
}


module.exports = { IsValidOrganisationToSendMessage, verifyGoogleLoginToken, hashPassword, verifyFacebookToken, generateTokens, Server_to_server_token, reformatTemplatePayload };
