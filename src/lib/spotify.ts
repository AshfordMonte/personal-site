type SpotifyImage = {
  url: string;
  width: number | null;
  height: number | null;
};

type SpotifyExternalUrls = {
  spotify: string;
};

type SpotifyArtist = {
  id: string;
  name: string;
  images: SpotifyImage[];
  external_urls: SpotifyExternalUrls;
};

type SpotifyTrack = {
  id: string;
  name: string;
  album: {
    images: SpotifyImage[];
  };
  artists: Array<{
    name: string;
  }>;
  external_urls: SpotifyExternalUrls;
};

type SpotifyTopResponse<T> = {
  items: T[];
};

export type MusicArtist = {
  id: string;
  name: string;
  imageUrl: string | null;
  spotifyUrl: string;
};

export type MusicTrack = {
  id: string;
  name: string;
  artistNames: string;
  imageUrl: string | null;
  spotifyUrl: string;
};

export type MusicData =
  | {
      configured: true;
      artists: MusicArtist[];
      tracks: MusicTrack[];
    }
  | {
      configured: false;
      artists: [];
      tracks: [];
    };

const env = import.meta.env;
const clientId = env.SPOTIFY_CLIENT_ID?.trim();
const clientSecret = env.SPOTIFY_CLIENT_SECRET?.trim();
const refreshToken = env.SPOTIFY_REFRESH_TOKEN?.trim();

const spotifyConfigured = Boolean(clientId && clientSecret && refreshToken);
const musicCacheTtlMs = 60 * 60 * 1000;

let musicDataCache: { data: MusicData; expiresAt: number } | null = null;
let musicDataRequest: Promise<MusicData> | null = null;

async function getAccessToken() {
  if (!spotifyConfigured) {
    throw new Error('Spotify credentials are not configured.');
  }

  const tokenUrl = 'https://accounts.spotify.com/api/token';
  const tokenBody = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  };

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(tokenBody)
  });

  const data = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok && response.status === 400) {
    const pkceResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        ...tokenBody,
        client_id: clientId
      })
    });

    const pkceData = (await pkceResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (pkceResponse.ok && pkceData.access_token) {
      return pkceData.access_token;
    }

    throw new Error(formatSpotifyError('Spotify token request failed', pkceResponse.status, pkceData));
  }

  if (!response.ok) {
    throw new Error(formatSpotifyError('Spotify token request failed', response.status, data));
  }

  if (!data.access_token) {
    throw new Error('Spotify token response did not include an access token.');
  }

  return data.access_token;
}

function formatSpotifyError(
  message: string,
  status: number,
  data: { error?: string; error_description?: string }
) {
  const spotifyMessage = [data.error, data.error_description].filter(Boolean).join(': ');

  return spotifyMessage ? `${message} with ${status}: ${spotifyMessage}.` : `${message} with ${status}.`;
}

async function getTopItems<T>(accessToken: string, type: 'artists' | 'tracks') {
  const params = new URLSearchParams({
    time_range: 'medium_term',
    limit: '10'
  });
  const response = await fetch(`https://api.spotify.com/v1/me/top/${type}?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Spotify top ${type} request failed with ${response.status}.`);
  }

  return (await response.json()) as SpotifyTopResponse<T>;
}

export async function getMusicData(): Promise<MusicData> {
  if (!spotifyConfigured) {
    return {
      configured: false,
      artists: [],
      tracks: []
    };
  }

  if (musicDataCache && musicDataCache.expiresAt > Date.now()) {
    return musicDataCache.data;
  }

  if (musicDataRequest) {
    return musicDataRequest;
  }

  musicDataRequest = fetchMusicData()
    .then((data) => {
      musicDataCache = {
        data,
        expiresAt: Date.now() + musicCacheTtlMs
      };

      return data;
    })
    .finally(() => {
      musicDataRequest = null;
    });

  return musicDataRequest;
}

async function fetchMusicData(): Promise<MusicData> {
  const accessToken = await getAccessToken();
  const [artists, tracks] = await Promise.all([
    getTopItems<SpotifyArtist>(accessToken, 'artists'),
    getTopItems<SpotifyTrack>(accessToken, 'tracks')
  ]);

  return {
    configured: true,
    artists: artists.items.map((artist) => ({
      id: artist.id,
      name: artist.name,
      imageUrl: artist.images[0]?.url ?? null,
      spotifyUrl: artist.external_urls.spotify
    })),
    tracks: tracks.items.map((track) => ({
      id: track.id,
      name: track.name,
      artistNames: track.artists.map((artist) => artist.name).join(', '),
      imageUrl: track.album.images[0]?.url ?? null,
      spotifyUrl: track.external_urls.spotify
    }))
  };
}
