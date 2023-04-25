//This is an example of the function used in the original implementation of the app. It was made so might as well show it.
// It would just run this function, but with all the albums a user has saved in their spotify as opposed to this dummy 'album' JSON
const axios = require('axios')
const cheerio = require('cheerio')

album = {
    artist:'pink-floyd',
    album:'the-dark-side-of-the-moon'
}
async function getAlbumScore() 
{
	try 
    {
		const response = await axios.get(
			'https://rateyourmusic.com/release/album/' + album.artist +'/'+ album.album
		)
        const $=cheerio.load(response.data)
        const rating = $('span.avg_rating').text().trim()

		console.log(rating)

	} 
    catch (error) 
    {
		console.error(error)
	}
}

getAlbumScore()