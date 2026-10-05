export interface Track {
  artist: string;
  title: string;
  album?: string | null;
  releaseDate?: string | null;
  artworkUrl?: string | null;
  songUrl?: string | null;
  previewUrl?: string | null;
  timecode?: string | null;
  source: string;
}

export interface Lyrics {
  track: string;
  artist: string;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  source: string;
}

export interface MusicRecognition { track: Track | null; }

export interface MusicServices {
  recognize(file: File): Promise<MusicRecognition>;
  searchLyrics(query: string): Promise<Lyrics[]>;
  similarTracks(track: Track): Promise<Track[]>;
}