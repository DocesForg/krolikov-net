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
  album?: string | null;
  artworkUrl?: string | null;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  source: string;
}

export interface AiSimilarTrack {
  artist: string;
  title: string;
  reason: string;
}

export interface AiTrackInsight {
  summary: string;
  genres: string[];
  mood: string[];
  similarArtists: string[];
  recommendations: string[];
  similarTracks: AiSimilarTrack[];
}

export interface MusicRecognition { track: Track | null; }

export interface LyricsSearchResult {
  yandex: {
    found: boolean;
    artist: string;
    title: string;
    confidence: number;
  } | null;
  results: Lyrics[];
}

export interface SimilarLyricsResult {
  recommendations: { artist: string; title: string }[];
  results: Lyrics[];
}

export interface MusicServices {
  recognize(file: File): Promise<MusicRecognition>;
  recognizeFromMicrophone(file: File): Promise<MusicRecognition>;
  searchLyrics(query: string): Promise<LyricsSearchResult>;
  searchSimilarLyrics(artist: string, title: string): Promise<SimilarLyricsResult>;
  similarTracks(track: Track): Promise<Track[]>;
  analyzeTrack(track: Track): Promise<AiTrackInsight>;
}


export interface YandexSearchSource {
  title: string;
  url: string;
  used: boolean;
}

export interface YandexGenerativeResult {
  answer: string;
  sources: YandexSearchSource[];
  searchQueries: string[];
  fixedQuery?: string | null;
  rejected: boolean;
}
