# Media Search

Create notes for **books, movies, TV shows, albums, songs and artists** in Obsidian, one at a time or from a pasted list.

A fork of [Obsidian Book Search](https://github.com/anpigon/obsidian-book-search-plugin) by anpigon, extended to other media with smarter search.

## What it does

| Type | Source | Key needed |
| --- | --- | --- |
| Books | Hardcover, Google Books, Open Library (combined), Naver | Hardcover: free token. Google: optional |
| Movies | TMDB, plus OMDb for IMDb / Rotten Tomatoes ratings and awards | TMDB: free key. OMDb: optional |
| TV shows | TMDB, plus OMDb | same as movies |
| Albums | Deezer, plus MusicBrainz for detailed genres and original year | none |
| Songs | Deezer | none |
| Artists / bands | Deezer, plus MusicBrainz for country, years active and members | none |

**Smart search**
- Understands `Dune by Frank Herbert`, `Radiohead - OK Computer`, `Heat (1995)`, `Heat 1995`, ISBNs, and IMDb, TMDB and Deezer links.
- Ranks results by how well the title and creator match, popularity, year and completeness. Summaries, study guides, karaoke and tribute versions drop to the bottom.
- Searches several book sources at once and merges editions of the same book, filling gaps (cover, description, ISBN) from the others.
- Tolerates typos, accents, punctuation and leading articles ("The").

**Notes from a list:** paste a list (or select one in a note), check the matches, and every note is created at once. Already-existing notes are detected and skipped. Selected lines can be replaced with links to the new notes.

## Quick start

1. Install the plugin and enable it.
2. In **Settings → Media Search**, set a folder, file name and template for each type you use. For movies and TV, add a free [TMDB API key](https://www.themoviedb.org/settings/api).
3. Run a command from the command palette.

| Command | What it does |
| --- | --- |
| Create book / movie / TV show / album / song / artist note | Search, pick a result, create the note |
| Create notes from a list | Bulk create from pasted text or the current selection |
| Insert metadata into current note | Search using the selection or the note name, insert at the top |

The ribbon icon asks which type to create. Each type can be turned off in settings to hide its command.

## Templates

Use `{{variable}}` in a template file. Every list field also gets a **Links** version that renders as a frontmatter list of wikilinks:

```yaml
source: {{directorsLinks}}   # ["[[David Fincher]]"]
cast: {{castLinks}}          # ["[[Brad Pitt]]", "[[Edward Norton]]"]
category: {{genresLinks}}    # ["[[Drama]]", "[[Thriller]]"]
```

Full variable list per type: [docs/template-variables.md](docs/template-variables.md). Ready-made templates: [templates/](templates/).

## License

[Obsidian Book Search Plugin](https://github.com/anpigon/obsidian-book-search-plugin) is licensed under the GNU AGPLv3 license. Refer to [LICENSE](https://github.com/SilentVoid13/Templater/blob/master/LICENSE.TXT) for more information.

<br>

## Contributing

Feel free to contribute.

You can create an [issue](https://github.com/anpigon/obsidian-book-search-plugin/issues) to report a bug, suggest an improvement for this plugin, ask a question, etc.

You can make a [pull request](https://github.com/anpigon/obsidian-book-search-plugin/pulls) to contribute to this plugin development.

<br>

## Support

If this plugin helped you and you wish to contribute :)

Buy me coffee on [buymeacoffee.com/anpigon](https://www.buymeacoffee.com/anpigon)

<a href="https://www.buymeacoffee.com/anpigon" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60"></a>&nbsp;
<a href="https://anpigon.github.io/buymeacoffee/"><img src="https://user-images.githubusercontent.com/3969643/184924261-f0224843-08fa-4bce-af70-dc5db589979f.png" height="60"></a>
