export interface APIError extends Error {
    statusCode?: number;
}

export interface Artist {
    name: string;
    popularity: number;
    image: string;
}

export interface CacheEntry {
    data: Artist[];
    timestamp: number;
}
export class SpotifyAPIError extends Error {
    constructor(
        public statusCode: number,
        message: string
    ) {
        super(message);
        this.name = 'SpotifyAPIError';
    }
}

export class AuthenticationError extends Error {
    constructor(message: string = 'Authentication failed') {
        super(message);
        this.name = 'AuthenticationError';
    }
}