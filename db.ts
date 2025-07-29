import Database from 'better-sqlite3';
import { Album } from './types/interfaces';

const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/ratings.db' : './ratings.db';
let db: Database.Database;

try {
    db = new Database(dbPath);
    console.log('Database initialized successfully');
} catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
}

// Table inits
db.exec(`
    CREATE TABLE IF NOT EXISTS album_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        album_name TEXT NOT NULL,
        artist_name TEXT NOT NULL,
        rating REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(album_name, artist_name)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS user_albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        album_name TEXT NOT NULL,
        artist_name TEXT NOT NULL,
        primary_artist TEXT,
        album_image TEXT,
        spotify_album_id TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_synced DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, album_name, artist_name)
    )
`);

try {
    db.exec(`ALTER TABLE user_albums ADD COLUMN primary_artist TEXT`);
} catch (error) {
}

interface DatabaseRating {
    rating: number | null;
}

const getRatingStmt = db.prepare('SELECT rating FROM album_ratings WHERE album_name = ? AND artist_name = ?');
const insertRatingStmt = db.prepare(`
    INSERT OR REPLACE INTO album_ratings (album_name, artist_name, rating, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
`);

const getUserAlbumsStmt = db.prepare(`
    SELECT album_name, artist_name, primary_artist, album_image, last_synced
    FROM user_albums
    WHERE user_id = ?
    ORDER BY added_at DESC
`);
const insertUserAlbumStmt = db.prepare(`
    INSERT OR REPLACE INTO user_albums (user_id, album_name, artist_name, primary_artist, album_image, spotify_album_id, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);
const clearUserAlbumsStmt = db.prepare('DELETE FROM user_albums WHERE user_id = ?');

// Database operations
export const DatabaseOperations = {
    // Rating operations
    getRating(albumName: string, artistName: string): number | null | undefined {
        const lowerAlbum = albumName.toLowerCase();
        const lowerArtist = artistName.toLowerCase();
        console.log(`DB getRating: Looking for "${lowerAlbum}" by "${lowerArtist}"`);
        const result = getRatingStmt.get(lowerAlbum, lowerArtist) as DatabaseRating | undefined;
        if (result === undefined) {
            console.log(`DB getRating: No entry found for "${lowerAlbum}" by "${lowerArtist}" (not in database)`);
            return undefined as any;
        } else if (result.rating !== null) {
            console.log(`DB getRating: Found rating ${result.rating} for "${lowerAlbum}" by "${lowerArtist}"`);
            return result.rating;
        } else {
            console.log(`DB getRating: Found entry with null rating for "${lowerAlbum}" by "${lowerArtist}" (API was called but no rating found)`);
            return null;
        }
    },

    saveRating(albumName: string, artistName: string, rating: number | null): void {
        const lowerAlbum = albumName.toLowerCase();
        const lowerArtist = artistName.toLowerCase();
        console.log(`DB saveRating: Saving rating ${rating} for "${lowerAlbum}" by "${lowerArtist}"`);
        insertRatingStmt.run(lowerAlbum, lowerArtist, rating);
    },

    // User album operations
    getUserAlbums(userId: string): Array<{
        album_name: string;
        artist_name: string;
        primary_artist: string;
        album_image: string;
        last_synced: string;
    }> {
        return getUserAlbumsStmt.all(userId) as Array<{
            album_name: string;
            artist_name: string;
            primary_artist: string;
            album_image: string;
            last_synced: string;
        }>;
    },

    saveUserAlbum(userId: string, albumName: string, artistsString: string, primaryArtist: string, albumImage: string, spotifyId: string): void {
        insertUserAlbumStmt.run(userId, albumName, artistsString, primaryArtist, albumImage, spotifyId);
    },

    clearUserAlbums(userId: string): void {
        clearUserAlbumsStmt.run(userId);
    },

    close(): void {
        db.close();
    },

    debugShowAllRatings(): void {
        const allRatings = db.prepare('SELECT album_name, artist_name, rating FROM album_ratings ORDER BY album_name').all() as Array<{
            album_name: string;
            artist_name: string;
            rating: number | null;
        }>;
        console.log(`Debug: Found ${allRatings.length} ratings in database:`);
        for (const rating of allRatings) {
            console.log(`  "${rating.album_name}" by "${rating.artist_name}" = ${rating.rating}`);
        }
    },

    clearAllRatings(): void {
        db.prepare('DELETE FROM album_ratings').run();
        console.log('Debug: Cleared all ratings from database');
    },

    debugCheckAlbum(albumName: string, artistName: string): void {
        const lowerAlbum = albumName.toLowerCase();
        const lowerArtist = artistName.toLowerCase();
        const result = db.prepare('SELECT * FROM album_ratings WHERE album_name = ? AND artist_name = ?').get(lowerAlbum, lowerArtist);
        console.log(`Debug: Checking "${lowerAlbum}" by "${lowerArtist}":`, result);

        const similar = db.prepare('SELECT * FROM album_ratings WHERE album_name LIKE ? OR artist_name LIKE ?').all(`%${lowerAlbum}%`, `%${lowerArtist}%`);
        console.log(`Debug: Similar entries:`, similar);
    },

    clearAlbumRating(albumName: string, artistName: string): void {
        const lowerAlbum = albumName.toLowerCase();
        const lowerArtist = artistName.toLowerCase();
        db.prepare('DELETE FROM album_ratings WHERE album_name = ? AND artist_name = ?').run(lowerAlbum, lowerArtist);
        console.log(`Debug: Cleared rating for "${lowerAlbum}" by "${lowerArtist}"`);
    }
};