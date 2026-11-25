# Template variables

Write `{{name}}` in a template file or in the file name format. Missing values render as empty, and empty brackets in file names are removed (`Fight Club ()` becomes `Fight Club`).

## Available in every type

| Variable | Description |
| --- | --- |
| `title` | Title (artist name for artists) |
| `description` | Summary / overview. No line breaks or double quotes, so it is safe inside `"…"` |
| `link`, `url` | Web page of the item (`url` is an alias) |
| `coverUrl`, `coverSmallUrl`, `coverMediumUrl`, `coverLargeUrl` | Cover / poster / photo URLs |
| `localCoverImage` | Path of the downloaded cover (needs "Save cover images") |
| `<list>Links` | Any list field as a frontmatter list of wikilinks, e.g. `castLinks`, `genresLinks`, `authorsLinks` |
| `<list>List` | Any list field as a frontmatter list of plain strings, e.g. `genresList` |
| `{{DATE}}`, `{{DATE:YYYY-MM-DD}}`, `{{date}}`, `{{time}}` | Current date / time |

List fields used directly (`{{cast}}`) render comma-separated.

## Books

| Variable | Description |
| --- | --- |
| `subtitle` | Subtitle |
| `author` / `authors` | Authors (text / list) |
| `category` / `categories` | Categories (text / list) |
| `publisher`, `publishDate`, `totalPage` | Publication details |
| `isbn10`, `isbn13` | ISBNs |
| `previewLink` | Google Books preview |

## Movies

| Variable | Description |
| --- | --- |
| `originalTitle`, `year`, `releaseDate`, `tagline`, `runtime` (minutes) | Basics |
| `director` / `directors`, `writer` / `writers` | Crew (text / list) |
| `cast` (list), `actors` (text) | Top 5 billed cast |
| `genre` / `genres`, `country` / `countries`, `language` / `languages` | Text / list |
| `collection` | Franchise, e.g. "The Dark Knight Collection" |
| `rating` | TMDB rating out of 10 |
| `imdbRating`, `rottenTomatoes`, `metascore`, `awards` | Need an OMDb key |
| `tmdbId`, `imdbId`, `imdbUrl`, `backdropUrl` | IDs and links |

## TV shows

| Variable | Description |
| --- | --- |
| `year`, `endYear`, `yearRange` | `yearRange` is `2015–2022`, or `2024–` while still airing |
| `firstAirDate`, `lastAirDate`, `airingStatus` | e.g. "Ended", "Returning Series" |
| `creator` / `creators`, `cast`, `actors` | People |
| `seasons`, `episodes`, `episodeRuntime` | Counts |
| `network` / `networks`, `genre` / `genres`, `country` / `countries`, `language` | Text / list |
| `rating`, `imdbRating`, `awards`, `tmdbId`, `imdbId`, `imdbUrl` | Ratings and IDs |

## Albums

| Variable | Description |
| --- | --- |
| `artist` / `artists` | Main artist / all credited artists |
| `year`, `releaseDate` | Original release, from MusicBrainz when enabled |
| `genre` / `genres` | Detailed genres from MusicBrainz, otherwise Deezer's |
| `label`, `albumType` (album, ep, single, compile), `trackCount`, `duration`, `upc`, `explicit` | Details |
| `tracks` (list), `tracklist` | `tracklist` is a numbered markdown list with durations |
| `deezerId`, `musicbrainzId` | IDs |

## Songs

| Variable | Description |
| --- | --- |
| `artist` / `artists`, `album` | Credits |
| `year`, `releaseDate`, `genre` / `genres` | Details |
| `duration`, `trackNumber`, `discNumber`, `bpm`, `isrc`, `explicit` | Details |
| `previewUrl`, `deezerId` | 30-second preview and ID |

## Artists / bands

| Variable | Description |
| --- | --- |
| `name`, `artistType` | Group, Person, Orchestra… |
| `country`, `area`, `beginArea` | Where they are from / formed |
| `formed`, `disbanded`, `active` | `active` is `1991–present` |
| `genre` / `genres` | Genres |
| `members`, `formerMembers` | Lists. Use `membersLinks` for wikilinks |
| `fans`, `albumCount`, `deezerId`, `musicbrainzId` | Deezer stats and IDs |

## Inline scripts

`<%= ... %>` runs JavaScript with the item available as `book`, `media`, or its type name (`movie`, `series`, `show`, `album`, `track`, `song`, `artist`).


- The object "book" gives access to all attributes managed by the plugin.
- Using `<%= book %>` one can manipulate the different attributes, or use all attributes together.

### To print out a book object:

````
```json
<%=book%>
```
````

or

````
```json
<%=JSON.stringify(book, null, 2)%>
```
````

### When you want to list or link authors:

```
---
authors: <%=book.authors.map(author=>`\n  - ${author}`).join('')%>
---

authors: <%=book.authors.map(author => `[[${author}]]`).join(', ')%>
```

### When you want to list or link categories:

```
---
categories: <%=book.categories.map(category=>`\n  - ${category}`).join('')%>
---

categories: <%=book.categories.map(category => `[[${category}]]`).join(', ')%>
```

### When you want to isolate publication year

```
published_at: <%= book.publishDate.substring(0, 4) %>
```

### When you want to have the publucation date under the format YYYYMMDD and not YYYY-MM-DD

```
published_at: <%= book.publishDate.replace(/-/g,'') %>
```


## Google Books API key

If the plugin fails to fetch book metadata, it might be that you have hit the free API rate limits, and need to add an API key.

Here's how to create and use one:
- Create a project on [Google Cloud](https://console.cloud.google.com/projectcreate)
- Enable the Books API for your project using the [Books API page](https://console.cloud.google.com/apis/library/books.googleapis.com)
- Create an API key for your Google Cloud project using the [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials) page
- To limit the security risks of losing that key, you can edit it, and click on "Restrict key" under "API restrictions", then select only the "Books API" API
- Add the API key to the settings of the Book Search plugin, under "Google Books API key"
- Once added, click on "Save", 



## Related

- [README](../README.md): overview and quick start
- [Example templates](../templates/)
