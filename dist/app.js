"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const request_1 = __importDefault(require("request"));
const cors_1 = __importDefault(require("cors"));
const querystring_1 = __importDefault(require("querystring"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const path_1 = __importDefault(require("path"));
// Building the app
const app = (0, express_1.default)();
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'templates')))
    .use((0, cors_1.default)())
    .use((0, cookie_parser_1.default)())
    .engine('html', require('ejs').renderFile)
    .set('view engine', 'html')
    .set('views', path_1.default.join(__dirname, '..', 'templates'));
// Spotify App credentials
const redirect_uri = process.env.NODE_ENV === 'production'
    ? 'https://spotify-popularity-tracker.vercel.app/callback'
    : 'http://localhost:8888/callback';
const client_id = process.env.client_id;
const client_secret = process.env.client_secret;
const state_key = 'spotify_auth_state';
const scope = 'user-follow-read';
// Function that generates a random string to use as the app's state as a security measure
const generate_random_string = () => {
    let string = '';
    const possible_chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < 16; i++) {
        string += possible_chars.charAt(Math.floor(Math.random() * possible_chars.length));
    }
    return string;
};
app.get('/login', (req, res) => {
    // Authorizes user with Spotify, sends client information in URL
    const state = generate_random_string();
    res.cookie(state_key, state);
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring_1.default.stringify({
            response_type: 'code',
            client_id: client_id,
            scope: scope,
            redirect_uri: redirect_uri,
            state: state,
            show_dialog: true
        }));
});
app.get('/callback', (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;
    const stored_state = req.cookies ? req.cookies[state_key] : null;
    if (state === null || state !== stored_state) {
        res.redirect('/#' +
            querystring_1.default.stringify({
                error: 'incorrect state'
            }));
    }
    else {
        res.clearCookie(state_key);
        // Information needed to gain access token
        const auth_options = {
            url: 'https://accounts.spotify.com/api/token',
            form: {
                code: code,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
            },
            json: true
        };
        // Request made to Spotify API to receive an access token, followed by calling the function to get a user's followed artist
        request_1.default.post(auth_options, (error, response, body) => __awaiter(void 0, void 0, void 0, function* () {
            if (!error && response.statusCode === 200) {
                const access_token = body.access_token;
                try {
                    const artist_info = yield get_all_followed(access_token);
                    const data = Object.values(artist_info).map((item) => item.popularity);
                    const scores = get_score_stats(data);
                    res.render('artists.html', { artist_info: artist_info, scores: scores });
                }
                catch (err) {
                    console.error(err);
                }
            }
        }));
    }
});
function get_all_followed(access_token) {
    return __awaiter(this, void 0, void 0, function* () {
        const limit = 50;
        let offset = 0;
        let total = 1;
        const artists = [];
        const get_artists = () => __awaiter(this, void 0, void 0, function* () {
            while (artists.length < total) {
                const response = yield fetch(`https://api.spotify.com/v1/me/following?type=artist&limit=${limit}&offset=${offset}`, {
                    headers: {
                        'Authorization': 'Bearer ' + access_token
                    }
                });
                const data = yield response.json();
                total = data.artists.total;
                offset += limit;
                artists.push(...data.artists.items);
            }
            return artists;
        });
        const artist_data = yield get_artists();
        const artist_info = artist_data.map((artist) => ({ name: artist.name, popularity: artist.popularity }));
        return artist_info;
    });
}
// Find the lowest, highest and average score, used for statistics on a users library
function get_score_stats(data) {
    let sum = data[0];
    let highest = data[0];
    let lowest = data[0];
    for (let i = 1; i < data.length; i++) {
        if (data[i] > highest) {
            highest = data[i];
        }
        if (data[i] < lowest) {
            lowest = data[i];
        }
        sum = sum + data[i];
    }
    return [highest, lowest, Math.round(sum / data.length)];
}
// For local development
if (process.env.NODE_ENV !== 'production') {
    console.log('Listening on 8888');
    app.listen(8888);
}
// This is required for Vercel - export the Express app
module.exports = app;
