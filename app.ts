import { APIError, Album, CacheEntry } from './types/interfaces';
import express, { Request, Response } from 'express';
import request from 'request';
import cors from 'cors';
import querystring from 'querystring';
import cookieParser from 'cookie-parser';
import path from 'path';
import dotenv from 'dotenv';
import session from 'express-session';
import { DatabaseOperations } from './db';
import { AlbumService } from './services';
dotenv.config();

// Different paths for local/prod since vercel needs dist/app.js
const views_path = process.env.NODE_ENV === 'production'
    ? path.join(__dirname, 'templates')  // Production path (templates are in dist/templates)
    : path.join(__dirname, 'templates');

declare module 'express-session' {
    interface Session {
        access_token?: string;
    }
}

const albumCache: Map<string, CacheEntry> = new Map();
const CACHE_DURATION = 1000 * 60 * 15; // 15 minutes

// Building the app
const app = express();
app.use(express.static(path.join(__dirname, 'templates')))
    .use('/static', express.static(path.join(__dirname, 'templates', 'static')))
    .use(cors())
    .use(cookieParser())
    .use(session({
        secret: process.env.cookie_secret as string,
        resave: false,
        saveUninitialized: true,
        cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // A week
    }))
    .engine('html', require('ejs').renderFile)
    .set('view engine', 'html')
    .set('views', views_path)
    .use((err: APIError, req: Request, res: Response, _next: any) => {
        console.error(err.stack);
        const statusCode = err.statusCode || 500;
        res.status(statusCode).json({
            error: err.message || 'Internal Server Error',
            status: statusCode
        });
    });

// Spotify App credentials
const redirect_uri = process.env.NODE_ENV === 'production'
    ? 'https://spotify-popularity-tracker.vercel.app/callback'
    : 'http://localhost:8888/callback';
const client_id = process.env.client_id as string
const client_secret = process.env.client_secret as string;
const state_key = 'spotify_auth_state';
const scope = 'user-library-read';

// Function that generates a random string to use as the app's state as a security measure
const generate_random_string = (): string => {
    let string = '';
    const possible_chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < 16; i++) {
        string += possible_chars.charAt(Math.floor(Math.random() * possible_chars.length));
    }
    return string;
};

// Routes
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

        // Request made to Spotify API to receive an access token
        request.post(auth_options, async (error: any, response: request.Response, body: any) => {
            if (!error && response.statusCode === 200) {
                const access_token = body.access_token;
                req.session.access_token = access_token;
                res.cookie('logged_in', 'true', { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false });
                res.redirect('/');
            }
        });
    }
});

app.get('/', async (req: Request, res: Response) => {
    if (req.cookies.logged_in === 'true' && req.session.access_token) {
        try {
            const album_info = await AlbumService.getAllAlbums(req.session.access_token);
            res.render('albums.html', { album_info });
        } catch (err) {
            console.error(err);
            res.redirect('/');
        }
    } else {
        res.render('index.html');
    }
});

app.get('/logout', (req: Request, res: Response) => {
    res.clearCookie('logged_in');
    res.redirect('/');
});

app.get('/privacy', (req: Request, res: Response) => {
    res.render('privacy.html');
});

app.post('/sync', async (req: Request, res: Response): Promise<void> => {
    if (!req.session.access_token) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }

    try {
        const userId = req.session.access_token.substring(0, 20);
        const albums = await AlbumService.syncAlbumsFromSpotify(req.session.access_token, userId);
        res.json({
            success: true,
            message: `Synced ${albums.length} albums`,
            albumCount: albums.length
        });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: 'Sync failed' });
    }
});

// Utility function for statistics (kept for future use)
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
        sum += data[i];
    }
    return [highest, lowest, Math.round(sum / data.length)];
}

// For local development
if (process.env.NODE_ENV !== 'production') {
    const server = app.listen(8888, () => {
        console.log('Listening on 8888');
    });

    process.on('SIGTERM', () => {
        console.log('Closing HTTP server');
        server.close(() => {
            console.log('HTTP server closed');
            DatabaseOperations.close();
            process.exit(0);
        });
    });
}

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

app.use((err: any, req: any, res: any, next: any) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// This is required for Vercel
module.exports = app;