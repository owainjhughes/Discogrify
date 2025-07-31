import { Pool, PoolClient } from 'pg';
import { Album } from './types/interfaces';

// PostgreSQL connection configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Initialize database tables
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        console.log('Initializing database tables...');
        
        // Create album_ratings table
        await client.query(`
            CREATE TABLE IF NOT EXISTS album_ratings (
                id SERIAL PRIMARY KEY,
                album_name TEXT NOT NULL,
                artist_name TEXT NOT NULL,
                rating REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(album_name, artist_name)
            )
        `);

        // Create user_albums table
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_albums (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                album_name TEXT NOT NULL,
                artist_name TEXT NOT NULL,
                primary_artist TEXT,
                album_image TEXT,
                spotify_album_id TEXT,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, album_name, artist_name)
            )
        `);

        // Add primary_artist column if it doesn't exist (migration for existing databases)
        try {
            await client.query(`ALTER TABLE user_albums ADD COLUMN primary_artist TEXT`);
        } catch (error) {
        }

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

initializeDatabase().catch(console.error);

interface DatabaseRating {
    rating: number | null;
}

// Database operations
export const DatabaseOperations = {
    // Rating operations
    async getRating(albumName: string, artistName: string): Promise<number | null | undefined> {
        const client = await pool.connect();
        try {
            const lowerAlbum = albumName.toLowerCase();
            const lowerArtist = artistName.toLowerCase();
            console.log(`DB getRating: Looking for "${lowerAlbum}" by "${lowerArtist}"`);
            
            const result = await client.query(
                'SELECT rating FROM album_ratings WHERE album_name = $1 AND artist_name = $2',
                [lowerAlbum, lowerArtist]
            );
            
            if (result.rows.length === 0) {
                console.log(`DB getRating: No entry found for "${lowerAlbum}" by "${lowerArtist}" (not in database)`);
                return undefined; // Signal that it's not in database at all
            } else if (result.rows[0].rating !== null) {
                console.log(`DB getRating: Found rating ${result.rows[0].rating} for "${lowerAlbum}" by "${lowerArtist}"`);
                return result.rows[0].rating;
            } else {
                console.log(`DB getRating: Found entry with null rating for "${lowerAlbum}" by "${lowerArtist}" (API was called but no rating found)`);
                return null;
            }
        } finally {
            client.release();
        }
    },

    async saveRating(albumName: string, artistName: string, rating: number | null): Promise<void> {
        const client = await pool.connect();
        try {
            const lowerAlbum = albumName.toLowerCase();
            const lowerArtist = artistName.toLowerCase();
            console.log(`DB saveRating: Saving rating ${rating} for "${lowerAlbum}" by "${lowerArtist}"`);
            
            await client.query(`
                INSERT INTO album_ratings (album_name, artist_name, rating, updated_at)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                ON CONFLICT (album_name, artist_name)
                DO UPDATE SET rating = $3, updated_at = CURRENT_TIMESTAMP
            `, [lowerAlbum, lowerArtist, rating]);
        } finally {
            client.release();
        }
    },

    // User album operations
    async getUserAlbums(userId: string): Promise<Array<{
        album_name: string;
        artist_name: string;
        primary_artist: string;
        album_image: string;
        last_synced: string;
    }>> {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT album_name, artist_name, primary_artist, album_image, last_synced
                FROM user_albums
                WHERE user_id = $1
                ORDER BY added_at DESC
            `, [userId]);
            return result.rows;
        } finally {
            client.release();
        }
    },

    async saveUserAlbum(userId: string, albumName: string, artistsString: string, primaryArtist: string, albumImage: string, spotifyId: string): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO user_albums (user_id, album_name, artist_name, primary_artist, album_image, spotify_album_id, last_synced)
                VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id, album_name, artist_name)
                DO UPDATE SET primary_artist = $4, album_image = $5, spotify_album_id = $6, last_synced = CURRENT_TIMESTAMP
            `, [userId, albumName, artistsString, primaryArtist, albumImage, spotifyId]);
        } finally {
            client.release();
        }
    },

    async clearUserAlbums(userId: string): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query('DELETE FROM user_albums WHERE user_id = $1', [userId]);
        } finally {
            client.release();
        }
    },

    async close(): Promise<void> {
        await pool.end();
    },

    // Debug method to show all ratings in database
    async debugShowAllRatings(): Promise<void> {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT album_name, artist_name, rating FROM album_ratings ORDER BY album_name');
            console.log(`Debug: Found ${result.rows.length} ratings in database:`);
            for (const rating of result.rows) {
                console.log(`  "${rating.album_name}" by "${rating.artist_name}" = ${rating.rating}`);
            }
        } finally {
            client.release();
        }
    },

    async clearAllRatings(): Promise<void> {
        const client = await pool.connect();
        try {
            const result = await client.query('DELETE FROM album_ratings');
            console.log(`Debug: Cleared ${result.rowCount} ratings from database`);
        } finally {
            client.release();
        }
    },

    async debugCheckAlbum(albumName: string, artistName: string): Promise<void> {
        const client = await pool.connect();
        try {
            const lowerAlbum = albumName.toLowerCase();
            const lowerArtist = artistName.toLowerCase();
            const result = await client.query('SELECT * FROM album_ratings WHERE album_name = $1 AND artist_name = $2', [lowerAlbum, lowerArtist]);
            console.log(`Debug: Checking "${lowerAlbum}" by "${lowerArtist}":`, result.rows[0] || 'Not found');
            
            const similar = await client.query('SELECT * FROM album_ratings WHERE album_name LIKE $1 OR artist_name LIKE $2', [`%${lowerAlbum}%`, `%${lowerArtist}%`]);
            console.log(`Debug: Similar entries:`, similar.rows);
        } finally {
            client.release();
        }
    },

    async clearAlbumRating(albumName: string, artistName: string): Promise<void> {
        const client = await pool.connect();
        try {
            const lowerAlbum = albumName.toLowerCase();
            const lowerArtist = artistName.toLowerCase();
            const result = await client.query('DELETE FROM album_ratings WHERE album_name = $1 AND artist_name = $2', [lowerAlbum, lowerArtist]);
            console.log(`Debug: Cleared rating for "${lowerAlbum}" by "${lowerArtist}"`);
        } finally {
            client.release();
        }
    },

    async clearParentheticalAlbumRatings(): Promise<void> {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                DELETE FROM album_ratings 
                WHERE album_name LIKE '%(%' 
                OR album_name LIKE '%[%'
            `);
            console.log(`Debug: Cleared ${result.rowCount} ratings for albums with parenthetical content`);
        } finally {
            client.release();
        }
    }
};