import dotenv from 'dotenv';
dotenv.config();
import { Pool, PoolClient } from 'pg';
import { Album } from './types/interfaces';

// PostgreSQL connection configuration
console.log('Database config:', {
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DATABASE,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD ? '[REDACTED]' : 'undefined'
});

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
    host: isProduction 
        ? process.env.POSTGRES_HOST 
        : 'aws-0-eu-west-2.pooler.supabase.com',
    port: parseInt(isProduction 
        ? process.env.POSTGRES_PORT || '5432' 
        : '6543'),
    database: process.env.POSTGRES_DATABASE,
    user: isProduction 
        ? process.env.POSTGRES_USER 
        : 'postgres.vsgcnxzclxdujjgkmuha',
    password: process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false },
});

let dbInitialized = false;

async function ensureInitialized() {
    if (!dbInitialized) {
        await initializeDatabase();
    }
}

async function initializeDatabase() {
    if (dbInitialized) return;

    try {
        const client = await pool.connect();
        try {
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

        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Database initialization failed:', error);
    }
}

interface DatabaseRating {
    rating: number | null;
}

// Database operations
export const DatabaseOperations = {
    // Rating operations
    async getRating(albumName: string, artistName: string): Promise<number | null | undefined> {
        try {
            await ensureInitialized();
            const client = await pool.connect();
            try {
                const lowerAlbum = albumName.toLowerCase();
                const lowerArtist = artistName.toLowerCase();

                const result = await client.query(
                    'SELECT rating FROM album_ratings WHERE album_name = $1 AND artist_name = $2',
                    [lowerAlbum, lowerArtist]
                );

                if (result.rows.length === 0) {
                    return undefined;
                } else if (result.rows[0].rating !== null) {
                    return result.rows[0].rating;
                } else {
                    return null;
                }
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Database error in getRating:', error);
            return undefined;
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
        try {
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
        } catch (error) {
            console.error('Database error in getUserAlbums:', error);
            return [];
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
    },

    async migrateUserData(oldUserId: string, newUserId: string): Promise<void> {
        try {
            const client = await pool.connect();
            try {
                await client.query('UPDATE user_albums SET user_id = $1 WHERE user_id = $2', [newUserId, oldUserId]);
                console.log(`Migrated user_albums from ${oldUserId} to ${newUserId}`);
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Database error in migrateUserData:', error);
            throw error;
        }
    }
};