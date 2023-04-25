// Imports
var express = require('express'); 
var request = require('request'); 
var cors = require('cors');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
var fetch = require('node-fetch');
var html = require('html');

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
    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) 
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
        var authOptions = 
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
                'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
            },
            json: true
        };

        request.post(authOptions, function(error, response, body) 
        {
            if (!error && response.statusCode === 200) 
            {
                var access_token = body.access_token;

                var options = 
                {
                    url: 'https://api.spotify.com/v1/me',
                    headers: 
                    { 
                        'Authorization': 'Bearer ' + access_token 
                    },
                    json: true
                };

                get_all_followed(access_token)
                .then(artist_info => 
                    {
                        //console.log(artist_info);
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

async function get_all_followed(access_token) 
{
    const limit = 50;
    let offset = 0;
    let total = 1;
    let artists = [];
    const accessToken = access_token;

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
