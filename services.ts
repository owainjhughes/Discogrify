import { Album } from './types/interfaces';
import { DatabaseOperations } from './db';
import { APIOperations } from './api';

export const AlbumService = {
    async getUserAlbumsFromDatabase(userId: string): Promise<Album[]> {
        const userAlbums = DatabaseOperations.getUserAlbums(userId);
        const albums: Album[] = [];

        // Debug: Show what ratings are in the database (only in development)
        if (process.env.NODE_ENV !== 'production') {
            console.log(`Debug: Checking ratings in database...`);
            DatabaseOperations.debugShowAllRatings();
        }

        for (const dbAlbum of userAlbums) {
            const album: Album = {
                name: dbAlbum.album_name,
                artists: dbAlbum.artist_name,
                image: dbAlbum.album_image
            };
            const primaryArtist = dbAlbum.primary_artist || dbAlbum.artist_name.split(', ')[0]; // fallback for old data

            console.log(`Looking up rating for: "${dbAlbum.album_name}" by "${primaryArtist}" (stored primary: "${dbAlbum.primary_artist}")`);
            const rating = DatabaseOperations.getRating(dbAlbum.album_name, primaryArtist);
            if (rating !== null && rating !== undefined) {
                console.log(`Found rating ${rating} for "${dbAlbum.album_name}" by "${primaryArtist}"`);
                album.rating = rating;
            } else {
                console.log(`No rating found for "${dbAlbum.album_name}" by "${primaryArtist}"`);
            }

            albums.push(album);
        }

        console.log(`Loaded ${albums.length} albums from database for user ${userId} (database-only, no API calls)`);
        return albums;
    },

    async syncAlbumsFromSpotify(access_token: string, userId: string): Promise<Album[]> {
        console.log(`Syncing albums from Spotify for user ${userId}`);
        const album_data = await APIOperations.fetchSpotifyAlbums(access_token);

        DatabaseOperations.clearUserAlbums(userId);

        const album_info: Album[] = [];

        console.log(`Processing ${album_data.length} albums from Spotify`);

        for (let i = 0; i < album_data.length; i++) {
            const item = album_data[i];
            const albumName = item.album.name;
            const artistsString = item.album.artists.map((artist: any) => artist.name).join(', ');
            const primaryArtist = item.album.artists[0]?.name || '';
            const albumImage = item.album.images && item.album.images.length > 0 ? item.album.images[0].url : '';

            DatabaseOperations.saveUserAlbum(
                userId,
                albumName,
                artistsString,
                primaryArtist,
                albumImage,
                item.album.id
            );

            const album: Album = {
                name: albumName,
                artists: artistsString,
                image: albumImage
            };

            try {
                const rating = await APIOperations.getRatingWithDatabase(albumName, primaryArtist);
                if (rating !== null) {
                    album.rating = rating;
                }
            } catch (error) {
                console.error(`Failed to fetch rating for ${albumName}:`, error);
            }

            album_info.push(album);
        }

        console.log(`Synced ${album_info.length} albums to database for user ${userId}`);
        return album_info;
    },

    async getAllAlbums(access_token: string): Promise<Album[]> {
        // Use access token as user ID for now (just first 20 chars, actual ID preferable in prod)
        const userId = access_token.substring(0, 20);

        // Always try to load from database first
        const existingAlbums = await this.getUserAlbumsFromDatabase(userId);

        if (existingAlbums.length > 0) {
            return existingAlbums;
        } else {
            console.log(`New user detected, fetching basic album info from Spotify for user ${userId}`);
            return await this.fetchAndStoreBasicAlbums(access_token, userId);
        }
    },

    async fetchAndStoreBasicAlbums(access_token: string, userId: string): Promise<Album[]> {
        console.log(`Fetching basic album info from Spotify for user ${userId}`);
        const album_data = await APIOperations.fetchSpotifyAlbums(access_token);

        DatabaseOperations.clearUserAlbums(userId);

        const album_info: Album[] = [];

        console.log(`Storing ${album_data.length} albums without ratings`);

        for (let i = 0; i < album_data.length; i++) {
            const item = album_data[i];
            const albumName = item.album.name;
            const artistsString = item.album.artists.map((artist: any) => artist.name).join(', ');
            const primaryArtist = item.album.artists[0]?.name || '';
            const albumImage = item.album.images && item.album.images.length > 0 ? item.album.images[0].url : '';

            DatabaseOperations.saveUserAlbum(
                userId,
                albumName,
                artistsString,
                primaryArtist,
                albumImage,
                item.album.id
            );

            const album: Album = {
                name: albumName,
                artists: artistsString,
                image: albumImage
            };

            album_info.push(album);
        }

        console.log(`Stored ${album_info.length} albums in database for user ${userId} (no ratings fetched)`);
        return album_info;
    }
};