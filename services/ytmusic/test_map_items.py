import unittest

from map_items import map_home, song_from, songs_page


class MapItemsTest(unittest.TestCase):
    def test_keeps_exact_video_id_and_marks_unavailable(self):
        song = song_from(
            {
                "videoId": "dQw4w9WgxcQ",
                "title": "Track",
                "artists": [{"name": "Artist"}],
                "duration": "3:05",
                "isAvailable": False,
                "thumbnails": [{"url": "https://example.test/a.jpg", "width": 60}],
            }
        )
        self.assertEqual(song["youtubeId"], "dQw4w9WgxcQ")
        self.assertEqual(song["id"], "yt:dQw4w9WgxcQ")
        self.assertEqual(song["artist"], "Artist")
        self.assertEqual(song["durationMs"], 185000)
        self.assertFalse(song["available"])

    def test_pagination_and_dropped_rows_without_video_ids(self):
        payload = {
            "tracks": [
                {"videoId": "aaaaaaaaaaa", "title": "One", "artists": [{"name": "A"}]},
                {"title": "No id"},
                {"videoId": "bbbbbbbbbbb", "title": "Two", "duration_seconds": 10},
            ]
        }
        page = songs_page(payload, 0, 1)
        self.assertEqual(len(page["items"]), 1)
        self.assertEqual(page["items"][0]["youtubeId"], "aaaaaaaaaaa")
        self.assertTrue(page["hasMore"])
        nxt = songs_page(payload, 1, 1)
        self.assertEqual(nxt["items"][0]["youtubeId"], "bbbbbbbbbbb")
        self.assertFalse(nxt["hasMore"])

    def test_home_sections_stay_separate(self):
        home = map_home(
            [
                {
                    "title": "Listen again",
                    "contents": [
                        {
                            "title": "Song",
                            "videoId": "ccccccccccc",
                            "artists": [{"name": "C"}],
                        }
                    ],
                },
                {
                    "title": "Mixed for you",
                    "contents": [
                        {"title": "A playlist", "playlistId": "PLxxxx"},
                        {"title": "Album only", "browseId": "MPREaaaa"},
                    ],
                },
            ]
        )
        self.assertEqual([s["title"] for s in home["sections"]], ["Listen again", "Mixed for you"])
        self.assertEqual(home["sections"][0]["items"][0]["song"]["youtubeId"], "ccccccccccc")
        self.assertEqual(home["sections"][1]["items"][0]["kind"], "playlist")
        self.assertEqual(len(home["sections"][1]["items"]), 1)


if __name__ == "__main__":
    unittest.main()
