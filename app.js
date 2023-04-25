// Imports
var express = require('express'); 
var request = require('request'); 
var cors = require('cors');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
var fetch = require('node-fetch');
var html = require('html');
const { start } = require('repl');

//Building the app
var app = express();
app.use(express.static(__dirname + '/templates'))
    .use(cors())
    .use(cookieParser())
    .engine('html', require('ejs').renderFile)
    .set('view engine', 'html');


// Spotify App credentials
var redirect_uri = 'http://localhost:8888/callback'; 
var client_id = 'dc81a408e2804f998ad6d882a56360d9'; 
var client_secret = 'a79e70246b7e43f0bc9d9629c5b559ac'; 
var stateKey = 'spotify_auth_state';
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
    res.cookie(stateKey, state);

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
    let start = Date.now();
    var code = req.query.code || null;
    var state = req.query.state || null;
    var stored_state = req.cookies ? req.cookies[stateKey] : null;

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
        res.clearCookie(stateKey);
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
                        let time_taken = Date.now() - start;
                        console.log(time_taken)
                        res.render((__dirname + '/templates/artists.html'), {artist_info: artist_info});
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

    const artistData = await get_artists();
    const artistInfo = artistData.map(artist => ({ name: artist.name, popularity: artist.popularity }));
    return artistInfo;
}


console.log('Listening on 8888');
app.listen(8888);
