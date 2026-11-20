package livetv

import (
	"crypto/sha1"
	"encoding/hex"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// Channel is one channel of a source. URL and Headers stay on the server
// (an address can carry a login): the app gets the rest, and plays a
// channel by its key.
type Channel struct {
	Key    string `json:"key"`
	Source string `json:"source"`
	Name   string `json:"name"`
	Logo   string `json:"logo,omitempty"`
	// Group is the playlist's group-title; "Animation;Kids" is in both.
	Group   string            `json:"group,omitempty"`
	URL     string            `json:"-"`
	Headers map[string]string `json:"-"`
	// EPGID is its id in the guide (tvg-id).
	EPGID   string `json:"epgId,omitempty"`
	Country string `json:"country,omitempty"`
	Number  int    `json:"number"`
	// RegionLocked: marked in the playlist as playing only in its own
	// country (Free-TV's Ⓖ, iptv-org's "[Geo-blocked]").
	RegionLocked bool `json:"regionLocked,omitempty"`
}

// stored is a channel as it's kept on disk (with its address).
type stored struct {
	Channel
	U string            `json:"u"`
	H map[string]string `json:"h,omitempty"`
}

// Groups are the groups a channel is in.
func (c Channel) Groups() []string {
	var out []string
	for _, g := range strings.Split(c.Group, ";") {
		if g = strings.TrimSpace(g); g != "" {
			out = append(out, g)
		}
	}
	return out
}

var (
	m3uAttr        = regexp.MustCompile(`([\w-]+)="([^"]*)"`)
	circledLetters = regexp.MustCompile(`[\x{24B6}-\x{24E9}]`)
	spaces         = regexp.MustCompile(`\s+`)
	brokenChrome   = regexp.MustCompile(`like Gecko\) Chrome/(\d+)`)
	idCountry      = regexp.MustCompile(`(?i)\.([a-z]{2})(?:@|$)`)
)

// m3uName is a channel's name in an #EXTINF line: after the first comma
// that follows the attributes (names may contain commas, "Love Nature,
// 4K"), else after the last comma. Lines a converter broke (a quote and a
// comma inside an attribute) still give the name at the end.
func m3uName(inf string) string {
	from := strings.LastIndexByte(inf, '"') + 1
	if i := strings.IndexByte(inf[from:], ','); i >= 0 {
		return strings.TrimSpace(inf[from+i+1:])
	}
	if i := strings.LastIndexByte(inf, ','); i >= 0 {
		return strings.TrimSpace(inf[i+1:])
	}
	return ""
}

// countryOfID is the country iptv-org's ids carry: "HumTV.pk@SD" is "pk".
func countryOfID(id string) string {
	if m := idCountry.FindStringSubmatch(id); m != nil {
		return m[1]
	}
	return ""
}

// channelKey names a channel of a source by what it is (its guide id, name
// and address), not by where it stands in the list: favourites keep it
// when the list is put in another order.
func channelKey(source, id, name, link string) string {
	sum := sha1.Sum([]byte(id + "\x00" + name + "\x00" + link))
	return source + ":" + hex.EncodeToString(sum[:8])
}

// streamScheme reports an address a player can open.
func streamScheme(link string) bool {
	u, err := url.Parse(link)
	if err != nil || u.Host == "" {
		return false
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		return true
	}
	return false
}

// ParseM3U reads an #EXTM3U playlist: the attributes of its #EXTINF lines,
// #EXTGRP, the #EXTVLCOPT headers and the "url|Header=value" form. guide is
// the XMLTV guide the playlist names for itself (url-tvg, x-tvg-url), "" for
// none. Only web addresses are kept (rtmp, rtsp and udp ones don't play
// here).
func ParseM3U(source, text string) (channels []Channel, guide string) {
	var info, extGroup string
	have := false
	options := map[string]string{}
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.TrimPrefix(raw, "\ufeff"))
		upper := strings.ToUpper(line)
		switch {
		case line == "":
		case strings.HasPrefix(upper, "#EXTM3U"):
			for _, m := range m3uAttr.FindAllStringSubmatch(line, -1) {
				if k := strings.ToLower(m[1]); (k == "url-tvg" || k == "x-tvg-url") && guide == "" {
					// Several, separated by commas: the first.
					guide = strings.TrimSpace(strings.Split(m[2], ",")[0])
				}
			}
		case strings.HasPrefix(upper, "#EXTINF"):
			info, have, extGroup = line, true, ""
			options = map[string]string{}
		case strings.HasPrefix(upper, "#EXTGRP:"):
			extGroup = strings.TrimSpace(line[len("#EXTGRP:"):])
		case strings.HasPrefix(upper, "#EXTVLCOPT:"):
			opt := line[len("#EXTVLCOPT:"):]
			k, v, _ := strings.Cut(opt, "=")
			switch strings.ToLower(strings.TrimSpace(k)) {
			case "http-referrer":
				options["Referer"] = v
			case "http-user-agent":
				options["User-Agent"] = v
			case "http-origin":
				options["Origin"] = v
			}
		case strings.HasPrefix(line, "#"):
		default:
			if !have {
				continue
			}
			have = false
			attrs := map[string]string{}
			for _, m := range m3uAttr.FindAllStringSubmatch(info, -1) {
				attrs[strings.ToLower(m[1])] = m[2]
			}
			rawName := m3uName(info)
			if rawName == "" {
				rawName = attrs["tvg-name"]
			}
			if rawName == "" {
				rawName = "Channel " + strconv.Itoa(len(channels)+1)
			}
			// Free-TV marks channels with circled letters (Ⓢ SD, Ⓖ
			// region-locked, Ⓨ YouTube): not part of the name.
			name := strings.TrimSpace(spaces.ReplaceAllString(circledLetters.ReplaceAllString(rawName, ""), " "))
			if name == "" {
				name = rawName
			}
			locked := strings.ContainsRune(rawName, 'Ⓖ') || strings.Contains(strings.ToLower(rawName), "geo-blocked")
			headers := map[string]string{}
			for k, v := range options {
				headers[k] = v
			}
			// iptv-org's way: the headers as attributes of the #EXTINF
			// line (#EXTVLCOPT lines win).
			for attr, h := range map[string]string{"http-referrer": "Referer", "http-user-agent": "User-Agent", "http-origin": "Origin"} {
				if v := attrs[attr]; v != "" && headers[h] == "" {
					headers[h] = v
				}
			}
			// Some converters cut http-user-agent="…(KHTML, like Gecko)
			// Chrome/120…" at its comma: the server wanted desktop Chrome.
			if headers["User-Agent"] == "" {
				if m := brokenChrome.FindStringSubmatch(info); m != nil {
					headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + m[1] + ".0.0.0 Safari/537.36"
				}
			}
			link := line
			if i := strings.IndexByte(line, '|'); i >= 0 {
				link = line[:i]
				for _, kv := range strings.Split(line[i+1:], "&") {
					k, v, _ := strings.Cut(kv, "=")
					k = strings.TrimSpace(k)
					if v, err := url.QueryUnescape(v); err == nil && k != "" && v != "" {
						if strings.EqualFold(k, "referrer") {
							k = "Referer"
						}
						headers[k] = v
					}
				}
			}
			if !streamScheme(link) {
				continue
			}
			for k, v := range headers {
				if !cleanHeader(k, v) {
					delete(headers, k)
				}
			}
			group := attrs["group-title"]
			if group == "" {
				group = extGroup
			}
			country := attrs["tvg-country"]
			if country == "" {
				country = countryOfID(attrs["tvg-id"])
			}
			number, err := strconv.Atoi(attrs["tvg-chno"])
			if err != nil {
				number = len(channels) + 1
			}
			c := Channel{
				Key: channelKey(source, attrs["tvg-id"], name, link), Source: source, Name: name, Logo: webLink(attrs["tvg-logo"]),
				URL: link, Headers: headers, EPGID: attrs["tvg-id"], Country: strings.ToUpper(country), Number: number, RegionLocked: locked,
			}
			c.Group = strings.Join(Channel{Group: group}.Groups(), ";")
			channels = append(channels, c)
		}
	}
	return channels, webLink(guide)
}

// webLink is link when it's an http(s) address, "" otherwise.
func webLink(link string) string {
	if streamScheme(link) {
		return link
	}
	return ""
}

// cleanHeader reports a header a playlist may set: a plain name and a value
// on one line, and none of those that would send a request elsewhere or
// pass for another.
func cleanHeader(k, v string) bool {
	if k == "" || len(k) > 64 || len(v) > 2048 || strings.ContainsAny(v, "\r\n") {
		return false
	}
	for _, r := range k {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-') || r > unicode.MaxASCII {
			return false
		}
	}
	switch strings.ToLower(k) {
	case "host", "content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer", "proxy-authorization":
		return false
	}
	return true
}

var (
	qualityFeeds = map[string]bool{"sd": true, "hd": true, "fhd": true, "uhd": true, "4k": true, "hq": true, "lq": true}
	// Quality marks only: a country in brackets, "ATV (Pakistan)", is part
	// of the name.
	qualityTags = regexp.MustCompile(`\((?:\d{3,4}p|hd|sd|fhd|uhd|4k)\)|\[[^\]]*\]|\b(?:hd|sd|fhd|uhd|4k|\d{3,4}p)\b`)
)

// guideID is a channel's id without its quality: iptv-org's "HumTV.pk@SD"
// and "HumTV.pk@HD" are one channel in two qualities, but
// "GodStandsTV.pk@Arabic" and "GodStandsTV.pk@Urdu" are two (what follows @
// is a feed: a quality, or a language or region).
func guideID(id string) string {
	id = strings.ToLower(strings.TrimSpace(id))
	base, feed, ok := strings.Cut(id, "@")
	if !ok || feed == "" || qualityFeeds[feed] {
		return base
	}
	return id
}

// sameName is a name without quality marks and punctuation, to tell the
// same channel in two lists.
func sameName(n string) string {
	n = qualityTags.ReplaceAllString(strings.ToLower(n), " ")
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return r
		}
		return -1
	}, n)
}

// alternatives are the same channel in the other lists (the same guide id,
// or the same name without quality marks), which the player tries when c
// doesn't play: public lists carry many channels twice, from different
// servers.
func alternatives(all []Channel, c Channel, max int) []Channel {
	id, name := guideID(c.EPGID), sameName(c.Name)
	seen := map[string]bool{c.URL: true}
	var out []Channel
	for _, o := range all {
		if o.Key == c.Key || seen[o.URL] {
			continue
		}
		other := guideID(o.EPGID)
		// Both have ids: they decide. Otherwise the names.
		same := id != "" && other != "" && id == other
		if id == "" || other == "" {
			same = len(name) >= 3 && sameName(o.Name) == name
		}
		if !same {
			continue
		}
		seen[o.URL] = true
		if out = append(out, o); len(out) >= max {
			break
		}
	}
	return out
}

// webPage names the service of a channel that is a web page rather than a
// stream (a YouTube or Twitch channel's live page, which playlists such as
// Free-TV list): it opens in the browser. "" for an ordinary stream.
func webPage(link string) string {
	u, err := url.Parse(link)
	if err != nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	on := func(domains ...string) bool {
		for _, d := range domains {
			if host == d || strings.HasSuffix(host, "."+d) {
				return true
			}
		}
		return false
	}
	switch {
	case on("youtube.com", "youtu.be"):
		return "YouTube"
	case on("twitch.tv"):
		return "Twitch"
	case on("dailymotion.com", "dai.ly"):
		return "Dailymotion"
	case on("facebook.com", "fb.watch"):
		return "Facebook"
	case on("vimeo.com"):
		return "Vimeo"
	}
	return ""
}
