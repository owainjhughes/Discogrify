// Imports
var express = require('express'); 
var request = require('request'); 
var cors = require('cors');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
var fetch = require('node-fetch');
var html = require('html');
const { start } = require('repl');
const path = require('path');

// Building the app
var app = express();
app.use(express.static(__dirname + '/templates'))
    .use(cors())
    .use(cookieParser())
    .engine('html', require('ejs').renderFile)
    .set('view engine', 'html');


// Spotify App credentials
var redirect_uri = process.env.NODE_ENV === 'production' 
    ? 'https://spotify-popularity-tracker.vercel.app/callback'
    : 'http://localhost:8888/callback'; 
var client_id = process.env.client_id 
var client_secret = process.env.client_secret; 
var state_key = 'spotify_auth_state';
var scope = 'user-follow-read';

// Function that generates a random string to use as the app's state as a security measure
var generate_random_string = function() 
{
    var string = '';
    var possible_chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    for (var i = 0; i < 16; i++)          
    {
        string += possible_chars.charAt(Math.floor(Math.random() * possible_chars.length));
    }
    return string;
};

app.get('/login', function(req, res) 
{
    // Authorizes user with Spotify, sends client information in URL
    var state = generate_random_string();
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

app.get('/callback', function(req, res) 
{
    var code = req.query.code || null;
    var state = req.query.state || null;
    var stored_state = req.cookies ? req.cookies[state_key] : null;

    if (state === null || state !== stored_state) 
    {
    res.redirect('/#' +
        querystring.stringify(
        {
            error: 'incorrect state'
        }));
    } 
    else 
    {
        res.clearCookie(state_key);
        // Information needed to gain access token
        var auth_options = 
        {
            url: 'https://accounts.spotify.com/api/token',
            form: 
            {
                code: code,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code'
            },
            headers: 
            {
                'Authorization': 'Basic ' + (new Buffer.from(client_id + ':' + client_secret).toString('base64'))
            },
            json: true
        };

        // Request made to Spotify API to receive an access token, followed by calling the function to get a user's followed artist
        request.post(auth_options, function(error, response, body) 
        {
            if (!error && response.statusCode === 200) 
            {
                var access_token = body.access_token;

                get_all_followed(access_token)
                .then(artist_info => 
                    {
                        const data = Object.values(artist_info).map((item) => item.popularity)
                        scores = get_score_stats(data)
                        res.render((__dirname + '/templates/artists.html'), {artist_info: artist_info, scores: scores});
                    })
                .catch(error => 
                    {
                        console.error(error);
                    });
            }
        });
    }
});


// Function to get all the artist a user follows on Spotify. limit and offset needed to gain artists above an index of 50, since the
// Spotify API only sends 50 objects per API call
async function get_all_followed(access_token) 
{
    const limit = 50;
    let offset = 0;
    let total = 1;
    let artists = [];

    const get_artists = async () => 
    {
        while (artists.length < total) 
        {
            const response = await fetch(`https://api.spotify.com/v1/me/following?type=artist&limit=${limit}&offset=${offset}`, 
            {
                headers: 
                {
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
    const artist_info = artist_data.map(artist => ({ name: artist.name, popularity: artist.popularity }));
    return artist_info;
}

// Find the lowest, highest and average score, used for statistics on a users library
function get_score_stats(data) 
{
    var sum = data[0];
    var highest = data[0];
    var lowest = data[0];
    for (var i = 1; i < data.length; i++) 
    {
        if (data[i] > highest) 
        {
            highest = data[i];
        }
        if (data[i] < lowest) 
        {
            lowest = data[i];
        }
        sum = sum + data[i];
    }
    return [highest, lowest, Math.round(sum/data.length)];
}

// For local development
if (process.env.NODE_ENV !== 'production') {
    console.log('Listening on 8888');
    app.listen(8888);
}

// This is required for Vercel - export the Express app
module.exports = app;