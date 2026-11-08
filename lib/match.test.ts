import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalVideoId,
  decideMatch,
  normalizeForMatch,
  type MatchCandidate,
} from "./match";

function c(
  videoId: string,
  title: string,
  author: string,
  durationSec = 0
): MatchCandidate {
  return { videoId, title, author, durationSec };
}

test("same title, different artists: Adele beats Lionel Richie", () => {
  const decision = decideMatch(
    [
      c("richieVid11", "Hello", "Lionel Richie", 251),
      c("adeleVid111", "Hello", "Adele - Topic", 295),
    ],
    { title: "Hello", artist: "Adele", durationSec: 295 }
  );
  assert.equal(decision.chosen?.videoId, "adeleVid111");
  assert.equal(decision.confidence, "high");
  assert.equal(canonicalVideoId(decision), "adeleVid111");
});

test("a closer cover does not beat the official recording", () => {
  const decision = decideMatch(
    [
      c("coverVid111", "Shape of You (Cover)", "Some Channel", 233),
      c("topicVid111", "Shape of You", "Ed Sheeran - Topic", 241),
    ],
    { title: "Shape of You", artist: "Ed Sheeran", durationSec: 233 }
  );
  assert.equal(decision.chosen?.videoId, "topicVid111");
  assert.equal(decision.confidence, "high");
  assert.ok(decision.chosen?.notes.includes("Official"));
});

test("an explicit remix request prefers the remix", () => {
  const decision = decideMatch(
    [
      c("plainVid111", "One Dance", "Drake - Topic", 173),
      c("remixVid111", "One Dance (Remix)", "Drake", 200),
    ],
    { title: "One Dance (Remix)", artist: "Drake", durationSec: 200 }
  );
  assert.equal(decision.chosen?.videoId, "remixVid111");
});

test("missing duration does not fall through to the first result", () => {
  const decision = decideMatch(
    [
      c("firstCover1", "Blinding Lights (Cover)", "Random", 0),
      c("topicLights", "Blinding Lights", "The Weeknd - Topic", 0),
    ],
    { title: "Blinding Lights", artist: "The Weeknd" }
  );
  assert.equal(decision.chosen?.videoId, "topicLights");
  assert.equal(decision.confidence, "high");
});

test("sped-up and karaoke uploads are not the silent default", () => {
  const decision = decideMatch(
    [
      c("spedVid1111", "Levitating (Sped Up)", "Fan Upload", 180),
      c("karaVid1111", "Levitating (Karaoke)", "Karaoke Version", 200),
      c("duaTopic111", "Levitating", "Dua Lipa - Topic", 203),
    ],
    { title: "Levitating", artist: "Dua Lipa", durationSec: 203 }
  );
  assert.equal(decision.chosen?.videoId, "duaTopic111");
  assert.equal(decision.chosen?.unwanted.length, 0);
});

test("Arabic title stays intact and beats a cover", () => {
  const normalized = normalizeForMatch("يا طير");
  assert.equal(normalized, "يا طير");
  const decision = decideMatch(
    [
      c("coverArabic", "يا طير (cover)", "Someone", 190),
      c("fairuzTopic", "يا طير", "فيروز - Topic", 200),
    ],
    { title: "يا طير", artist: "فيروز", durationSec: 200 }
  );
  assert.equal(decision.chosen?.videoId, "fairuzTopic");
  assert.equal(decision.confidence, "high");
});

test("a different Arabic song by the same artist is low confidence", () => {
  const decision = decideMatch(
    [c("otherArabic", "يا ليل", "فيروز - Topic", 180)],
    { title: "يا طير", artist: "فيروز", durationSec: 200 }
  );
  assert.equal(decision.confidence, "low");
  assert.equal(canonicalVideoId(decision), null);
});

test("provider order does not change the chosen video", () => {
  const query = { title: "Hello", artist: "Adele", durationSec: 295 };
  const items = [
    c("richieVid11", "Hello", "Lionel Richie", 295),
    c("adeleVid111", "Hello", "Adele - Topic", 290),
  ];
  const forward = decideMatch(items, query);
  const backward = decideMatch([...items].reverse(), query);
  assert.equal(forward.chosen?.videoId, backward.chosen?.videoId);
  assert.equal(canonicalVideoId(forward), canonicalVideoId(backward));
});

test("duration does not hand a song to a different artist", () => {
  const decision = decideMatch(
    [
      c("adeleVid111", "Hello", "Adele - Topic", 295),
      c("richieTopic", "Hello", "Lionel Richie - Topic", 251),
    ],
    { title: "Hello", artist: "Adele", durationSec: 251 }
  );
  assert.equal(decision.chosen?.videoId, "adeleVid111");
  assert.equal(decision.confidence, "high");
});

test("a cover with nothing better is a choice, not a silent play", () => {
  const decision = decideMatch(
    [c("coverVid111", "Shape of You (Cover)", "Someone", 233)],
    { title: "Shape of You", artist: "Ed Sheeran", durationSec: 233 }
  );
  assert.equal(decision.confidence, "low");
  assert.equal(canonicalVideoId(decision), null);
  assert.equal(decision.alternatives[0]?.videoId, "coverVid111");
});

test("VEVO is preferred over an unrelated first hit when duration is absent", () => {
  const decision = decideMatch(
    [
      c("unrelated11", "Hello", "Random Channel", 0),
      c("adeleVevo11", "Hello", "AdeleVEVO", 0),
    ],
    { title: "Hello", artist: "Adele" }
  );
  assert.equal(decision.chosen?.videoId, "adeleVevo11");
});
