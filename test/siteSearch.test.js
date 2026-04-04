const test = require("node:test");
const assert = require("node:assert/strict");

const {
  splitDelimitedText,
  filterSiteCatalogEntries,
  sortSiteCatalogEntries,
} = require("../src/shared/siteSearch");

const sampleEntries = [
  {
    atlasId: 1,
    title: "Project Velvet",
    creator: "Studio Nova",
    category: "VN",
    engine: "Ren'Py",
    status: "Completed",
    censored: "No",
    language: "English, Russian",
    tags: "romance, mystery, corruption",
    likes: "220",
    views: "5000",
    rating: "4.6",
    releaseDate: 1710000000,
    siteUrl: "https://f95zone.to/threads/project-velvet.1/",
    f95Id: 1,
  },
  {
    atlasId: 2,
    title: "Campus Heat",
    creator: "Blue Ember",
    category: "RPGM",
    engine: "RPGM",
    status: "Ongoing",
    censored: "No",
    language: "English",
    tags: "sandbox, corruption",
    likes: "80",
    views: "9000",
    rating: "4.2",
    releaseDate: 1720000000,
    siteUrl: "https://f95zone.to/threads/campus-heat.2/",
    f95Id: 2,
  },
  {
    atlasId: 3,
    title: "Quiet Harbor",
    creator: "Studio Nova",
    category: "VN",
    engine: "Unity",
    status: "Onhold",
    censored: "Yes",
    language: "Japanese, English",
    tags: "slice of life, mystery",
    likes: "310",
    views: "3000",
    rating: "4.9",
    releaseDate: 1700000000,
    siteUrl: "https://f95zone.to/threads/quiet-harbor.3/",
    f95Id: 3,
  },
];

test("splitDelimitedText trims and removes empty values", () => {
  assert.deepEqual(splitDelimitedText(" English, Russian, , German "), [
    "English",
    "Russian",
    "German",
  ]);
});

test("filterSiteCatalogEntries filters by creator, languages and AND tags", () => {
  const result = filterSiteCatalogEntries(sampleEntries, {
    text: "studio",
    type: "creator",
    language: ["English"],
    tags: ["mystery", "romance"],
    tagLogic: "AND",
    sort: "name",
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Project Velvet");
});

test("filterSiteCatalogEntries supports OR tag logic and numeric sorting", () => {
  const result = filterSiteCatalogEntries(sampleEntries, {
    tags: ["sandbox", "slice of life"],
    tagLogic: "OR",
    sort: "likes",
  });

  assert.deepEqual(
    result.map((entry) => entry.title),
    ["Quiet Harbor", "Campus Heat"],
  );
});

test("sortSiteCatalogEntries sorts by most recent date by default", () => {
  const result = sortSiteCatalogEntries(sampleEntries, "date");

  assert.deepEqual(
    result.map((entry) => entry.title),
    ["Campus Heat", "Project Velvet", "Quiet Harbor"],
  );
});
