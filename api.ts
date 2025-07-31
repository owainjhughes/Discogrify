import { Album } from './types/interfaces';
import { DatabaseOperations } from './db';
import dotenv from 'dotenv';
dotenv.config();

// Discogs API configuration
const DISCOGS_BASE_URL = 'https://api.discogs.com';
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN;
const USER_AGENT = 'SpotifyPopularityTracker/1.0 +http://localhost:8888';

// Rate limiter for Discogs API (60 requests per minute)
class DiscogsRateLimiter {
    private requests: number[] = [];
    private readonly maxRequests = 60;
    private readonly windowMs = 60 * 1000; // 60 secs

    async waitForSlot(): Promise<void> {
        const now = Date.now();

        this.requests = this.requests.filter(time => now - time < this.windowMs);

        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = Math.min(...this.requests);
            const waitTime = this.windowMs - (now - oldestRequest) + 100;

            if (waitTime > 0) {
                console.log(`Rate limit reached, waiting ${Math.ceil(waitTime / 1000)} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return this.waitForSlot();
            }
        }
        this.requests.push(now);
    }
}

const discogsRateLimiter = new DiscogsRateLimiter();

export const APIOperations = {
    async fetchSpotifyAlbums(access_token: string): Promise<any[]> {
        const limit = 50;
        let offset = 0;
        let total = 1;
        const albums: any[] = [];

        while (albums.length < total) {
            const response = await fetch(`https://api.spotify.com/v1/me/albums?limit=${limit}&offset=${offset}`, {
                headers: {
                    'Authorization': 'Bearer ' + access_token
                }
            });

            const data = await response.json();
            console.log(`Fetched ${data.items.length} albums from Spotify (${albums.length + data.items.length}/${data.total})`);
            total = data.total;
            offset += limit;
            albums.push(...data.items);
        }

        return albums;
    },

    generateAlbumNameVariations(albumName: string): string[] {
        const variations = [albumName];

        const cleaningPatterns = [
            /\s*\([^)]*\)/g,
            /\s*\[[^\]]*\]/g,

            /\s*-\s*(Deluxe|Expanded|Remastered|Anniversary|Special|Limited|Collector's?).*$/i,
            /\s*(Deluxe|Expanded|Remastered|Anniversary|Special|Limited|Collector's?)\s*(Edition|Version|Release).*$/i,

            /\s*-\s*(Live|Acoustic|Unplugged|MTV).*$/i,
            /\s*(Live|Acoustic|Unplugged|MTV)\s*(at|from|in|on).*$/i,

            /\s*-?\s*\d{4}.*$/,
            /\s*\(\d{4}\).*$/,

            /^The\s+/i
        ];

        let currentName = albumName;
        for (const pattern of cleaningPatterns) {
            const cleaned = currentName.replace(pattern, '').trim();
            if (cleaned && cleaned !== currentName && !variations.includes(cleaned)) {
                variations.push(cleaned);
                currentName = cleaned;
            }
        }
        return [...new Set(variations)].filter(name => name.length > 0);
    },

    normalizeText(text: string): string {
        return text.toLowerCase()
            .replace(/\s*\([^)]*\)/g, '')
            .replace(/\s*\[[^\]]*\]/g, '')
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    },

    findBestArtistMatch(artistName: string, artistResults: any[]): any | null {
        const normalizedSearchName = this.normalizeText(artistName);

        for (const artist of artistResults) {
            const normalizedArtistName = this.normalizeText(artist.title);
            if (normalizedArtistName === normalizedSearchName) {
                console.log(`Found exact artist match: "${artist.title}" for "${artistName}"`);
                return artist;
            }
        }

        for (const artist of artistResults) {
            const normalizedArtistName = this.normalizeText(artist.title);
            if (normalizedArtistName.includes(normalizedSearchName) || normalizedSearchName.includes(normalizedArtistName)) {
                console.log(`Found partial artist match: "${artist.title}" for "${artistName}"`);
                return artist;
            }
        }
        return null;
    },

    async searchArtistReleases(albumName: string, artistName: string): Promise<number | null> {
        try {
            console.log(`${albumName} by ${artistName}: Searching artist's releases as fallback`);

            const artistSearchData = await this.makeDiscogsRequest(
                `${DISCOGS_BASE_URL}/database/search?q=${encodeURIComponent(artistName)}&type=artist&per_page=10`,
                `${albumName} by ${artistName}: Artist search`
            );

            if (!artistSearchData || !artistSearchData.results || artistSearchData.results.length === 0) {
                console.log(`${albumName} by ${artistName}: No artists found`);
                return null;
            }

            const matchingArtist = this.findBestArtistMatch(artistName, artistSearchData.results);
            if (!matchingArtist) {
                console.log(`${albumName} by ${artistName}: No matching artist found among ${artistSearchData.results.length} results`);
                return null;
            }

            const releasesData = await this.makeDiscogsRequest(
                `${DISCOGS_BASE_URL}/artists/${matchingArtist.id}/releases?sort=year&sort_order=desc&per_page=50`,
                `${albumName} by ${artistName}: Artist releases`
            );

            if (!releasesData || !releasesData.releases) {
                return null;
            }

            const normalizedAlbumName = this.normalizeText(albumName);

            for (const release of releasesData.releases) {
                const normalizedReleaseTitle = this.normalizeText(release.title);

                const isExactMatch = normalizedReleaseTitle === normalizedAlbumName;
                const isPartialMatch = normalizedReleaseTitle.includes(normalizedAlbumName) || normalizedAlbumName.includes(normalizedReleaseTitle);

                if (isExactMatch || isPartialMatch) {
                    console.log(`${albumName} by ${artistName}: Found ${isExactMatch ? 'exact' : 'partial'} match "${release.title}" in artist releases`);

                    const detailData = await this.makeDiscogsRequest(
                        `${DISCOGS_BASE_URL}/releases/${release.id}`,
                        `${albumName} by ${artistName}: Artist release detail`
                    );

                    if (detailData && detailData.community && detailData.community.rating && detailData.community.rating.average) {
                        const rating = detailData.community.rating.average;
                        const normalizedRating = (rating / 5.0) * 10;
                        const finalRating = Math.round(normalizedRating * 10) / 10;
                        console.log(`${albumName} by ${artistName}: Rating ${finalRating}/10 - found via artist releases ("${release.title}")`);
                        return finalRating;
                    }

                    if (!isExactMatch) {
                        continue;
                    }
                }
            }

            console.log(`${albumName} by ${artistName}: No matching album found in ${releasesData.releases.length} releases`);
            return null;
        } catch (error) {
            console.log(`${albumName} by ${artistName}: Error searching artist releases`);
            return null;
        }
    },

    async getDiscogsRating(albumName: string, artistName: string): Promise<number | null> {
        if (!DISCOGS_TOKEN) {
            console.log(`${albumName} by ${artistName}: No Discogs token configured`);
            return null;
        }

        console.log(`${albumName} by ${artistName}: Starting Discogs search...`);

        try {
            const lightCleanedAlbum = albumName.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim();
            const lightCleanedArtist = artistName.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim();
            let searchQuery = `${lightCleanedAlbum} ${lightCleanedArtist}`;
            console.log(`${albumName} by ${artistName}: Direct search query: "${searchQuery}" (lightly cleaned)`);
            let searchData = await this.makeDiscogsRequest(
                `${DISCOGS_BASE_URL}/database/search?q=${encodeURIComponent(searchQuery)}&type=release&format=album&per_page=5`,
                `${albumName} by ${artistName}: Direct search (light clean)`
            );

            if (!searchData || !searchData.results || searchData.results.length === 0) {
                const cleanedAlbumName = this.normalizeText(albumName);
                const cleanedArtistName = this.normalizeText(artistName);
                searchQuery = `${cleanedAlbumName} ${cleanedArtistName}`;
                console.log(`${albumName} by ${artistName}: Trying aggressive normalization: "${searchQuery}"`);
                searchData = await this.makeDiscogsRequest(
                    `${DISCOGS_BASE_URL}/database/search?q=${encodeURIComponent(searchQuery)}&type=release&format=album&per_page=5`,
                    `${albumName} by ${artistName}: Direct search (aggressive clean)`
                );
            }

            if (searchData && searchData.results && searchData.results.length > 0) {
                for (let i = 0; i < Math.min(searchData.results.length, 3); i++) {
                    const release = searchData.results[i];
                    const releaseId = release.id;

                    const detailData = await this.makeDiscogsRequest(
                        `${DISCOGS_BASE_URL}/releases/${releaseId}`,
                        `${albumName} by ${artistName}: Direct search detail ${i + 1}`
                    );

                    if (detailData && detailData.community && detailData.community.rating && detailData.community.rating.average) {
                        const rating = detailData.community.rating.average;
                        const normalizedRating = (rating / 5.0) * 10;
                        const finalRating = Math.round(normalizedRating * 10) / 10;
                        console.log(`${albumName} by ${artistName}: Rating ${finalRating}/10 - found via direct search`);
                        return finalRating;
                    }
                }
            }
        } catch (error) {
            console.log(`${albumName} by ${artistName}: Direct search failed`);
        }

        const artistReleaseRating = await this.searchArtistReleases(albumName, artistName);
        if (artistReleaseRating !== null) {
            return artistReleaseRating;
        }

        console.log(`${albumName} by ${artistName}: No rating found via direct search or artist releases`);
        return null;
    },

    async makeDiscogsRequest(url: string, logPrefix: string): Promise<any> {
        const maxRetries = 5;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            await discogsRateLimiter.waitForSlot();

            const response = await fetch(url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Authorization': `Discogs token=${DISCOGS_TOKEN}`
                }
            });

            if (response.ok) {
                return await response.json();
            }

            if (response.status === 429) { // Rate Limited
                const waitTime = Math.min(60000, 5000 * attempt); // Exponential backoff, max 60s
                console.log(`${logPrefix}: Rate limited (429), waiting ${waitTime / 1000}s before retry ${attempt}/${maxRetries}`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            if (response.status >= 500) { // Server Error
                const waitTime = 1000 * attempt;
                console.log(`${logPrefix}: Server error (${response.status}), waiting ${waitTime / 1000}s before retry ${attempt}/${maxRetries}`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            console.log(`${logPrefix}: Failed (${response.status})`);
            return null;
        }

        console.log(`${logPrefix}: Failed after ${maxRetries} attempts`);
        return null;
    },

    // Checks if rating is in DB, if not, fetch from API
    async getRatingWithDatabase(albumName: string, artistName: string): Promise<number | null> {
        console.log(`API getRatingWithDatabase: Checking for "${albumName}" by "${artistName}"`);
        const dbRating = await DatabaseOperations.getRating(albumName, artistName);

        // Undefined = not in DB, null = in DB but no rating
        if (dbRating !== undefined) {
            if (dbRating !== null) {
                console.log(`${albumName} by ${artistName}: Rating ${dbRating}/10 (from database)`);
                return dbRating;
            } else {
                console.log(`${albumName} by ${artistName}: Previously checked, no rating available`);
                return null;
            }
        }

        console.log(`${albumName} by ${artistName}: Not in database, fetching from API`);
        const apiResult = await this.getDiscogsRating(albumName, artistName);
        if (apiResult !== null) {
            console.log(`${albumName} by ${artistName}: Got rating ${apiResult}/10 from API, saving to database`);
        } else {
            console.log(`${albumName} by ${artistName}: No rating found on Discogs, saving null to database`);
        }
        await DatabaseOperations.saveRating(albumName, artistName, apiResult);

        return apiResult;
    }
};