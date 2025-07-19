export interface APIError extends Error {
    statusCode?: number;
}

export interface Album {
    name: string;
    artists: string;
    image: string;
}

export interface CacheEntry {
    data: Album[];
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