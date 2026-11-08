import type { Song } from "./music";

export interface LibraryPlaylist {
  id: string;
  name: string;
  count?: string;
  art?: string;
}

export type LibrarySong = Song & { available: boolean };

export type HomeItem =
  | { kind: "song"; song: LibrarySong }
  | { kind: "playlist"; id: string; name: string; art?: string };

export interface HomeSection {
  title: string;
  items: HomeItem[];
}

export interface LibraryPage<T> {
  items: T[];
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface LibraryStatus {
  connected: boolean;
  method?: "oauth" | "browser" | null;
  accountName?: string;
  error?: string;
  service: boolean;
}
