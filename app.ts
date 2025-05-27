import express, { Request, Response } from 'express';
import request from 'request';
import cors from 'cors';
import querystring from 'querystring';
import cookieParser from 'cookie-parser';
import path from 'path';
import dotenv from 'dotenv';
import session from 'express-session';
dotenv.config();

// Different paths for local/prod since vercel needs dist/app.js
const views_path = process.env.VERCEL 
    ? path.join('/var/task', 'templates')  // Vercel serverless path
    : path.join(__dirname, 'templates');

declare module 'express-session' {
    interface SessionData {
        access_token?: string;
    }
}

// Building the app
const app = express();
app.use(express.static(path.join(__dirname, '..', 'templates')))
    .use('/static', express.static(path.join(__dirname, 'templates', 'static')))
    .use(cors())
    .use(cookieParser())
    .use(session({
        secret: process.env.cookie_secret as string,
        resave: false,
        saveUninitialized: true,
        cookie: {maxAge: 7 * 24 * 60 * 60 * 1000} 
    }))
    .engine('html', require('ejs').renderFile)
    .set('view engine', 'html')
    .set('views', views_path);

// Spotify App credentials
const redirect_uri = process.env.NODE_ENV === 'production'
    ? 'https://spotify-popularity-tracker.vercel.app/callback'
    : 'http://localhost:8888/callback';
const client_id = process.env.client_id as string
const client_secret = process.env.client_secret as string;
const state_key = 'spotify_auth_state';
const scope = 'user-follow-read';

// Function that generates a random string to use as the app's state as a security measure
const generate_random_string = (): string => {
    let string = '';
    const possible_chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < 16; i++) {
        string += possible_chars.charAt(Math.floor(Math.random() * possible_chars.length));
    }
    return string;
};

app.get('/login', (req: Request, res: Response) => {
    // Authorizes user with Spotify, sends client information in URL
    const state = generate_random_string();
    res.cookie(state_key, state);

    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: client_id,
            scope: scope,
            redirect_uri: redirect_uri,
            state: state,
            show_dialog: true
        }));
});

app.get('/callback', (req: Request, res: Response) => {
    const code = req.query.code as string || null;
    const state = req.query.state as string || null;
    const stored_state = req.cookies ? req.cookies[state_key] : null;

    if (state === null || state !== stored_state) {
        res.redirect('/#' +
            querystring.stringify({
                error: 'incorrect state'
            }));
    } else {
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
        request.post(auth_options, async (error: any, response: request.Response, body: any) => {
            if (!error && response.statusCode === 200) {
                const access_token = body.access_token;

                try {
                    const artist_info = await get_all_followed(access_token);
                    const data = Object.values(artist_info).map((item: any) => item.popularity);
                    const scores = get_score_stats(data);
                    req.session.access_token = access_token;
                    res.cookie('logged_in', 'true', { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false });
                    res.redirect('/');
                } catch (err) {
                    console.error(err);
                }
            }
        });
    }
});

//app.get('/artists', async (req: Request, res: Response) => {
//    if (req.cookies.logged_in === 'true' && req.session.access_token) {
//        try {
//            const artist_info = await get_all_followed(req.session.access_token);
//            const data = Object.values(artist_info).map((item: any) => item.popularity);
//            const scores = get_score_stats(data);
//            res.render('artists.html', { artist_info, scores });
//        } catch (err) {
//            console.error(err);
//            res.redirect('/');
//        }
//    } else {
//        res.redirect('/');
//    }
//});

app.get('/', async (req: Request, res: Response) => {
    if (req.cookies.logged_in === 'true' && req.session.access_token) {
        try {
            const artist_info = await get_all_followed(req.session.access_token);
            const data = Object.values(artist_info).map((item: any) => item.popularity);
            const scores = get_score_stats(data);
            res.render('artists.html', { artist_info, scores });
        } catch (err) {
            console.error(err);
            res.redirect('/');
        }
    } else {
        res.sendFile(path.join(__dirname, 'templates', 'index.html'));
    }
});

app.get('/logout', (req: Request, res: Response) => {
    res.clearCookie('logged_in');
    res.redirect('/');
});

app.get('/privacy', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, 'templates', 'privacy.html'));
});

interface Artist {
    name: string;
    popularity: number;
    image: string;
}

async function get_all_followed(access_token: string): Promise<Artist[]> {
    const limit = 50;
    let offset = 0;
    let total = 1;
    const artists: any[] = [];

    const get_artists = async () => {
        while (artists.length < total) {
            const response = await fetch(`https://api.spotify.com/v1/me/following?type=artist&limit=${limit}&offset=${offset}`, {
                headers: {
                    'Authorization': 'Bearer ' + access_token
                }
            });

            const data = await response.json();
            total = data.artists.total;
            offset += limit;
            artists.push(...data.artists.items);
        }
        return artists;
    };

    const artist_data = await get_artists();
    const artist_info: Artist[] = artist_data.map((artist: any) => ({ name: artist.name, popularity: artist.popularity, image: artist.images[0]?.url || ''}));
    return artist_info;
}

// Find the lowest, highest and average score, used for statistics on a users library
function get_score_stats(data: number[]): [number, number, number] {
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

// This is required for Vercel
module.exports = app;