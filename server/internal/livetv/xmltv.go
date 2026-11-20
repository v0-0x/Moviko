package livetv

import (
	"bufio"
	"compress/gzip"
	"encoding/xml"
	"io"
	"sort"
	"strings"
	"time"
)

// Programme is one programme of a channel's guide (unix seconds).
type Programme struct {
	Start int64  `json:"start"`
	Stop  int64  `json:"stop"`
	Title string `json:"title"`
	Desc  string `json:"desc,omitempty"`
}

// xmltvTime reads "20261120183000 +0100" (the zone may be missing: UTC).
func xmltvTime(s string) int64 {
	s = strings.TrimSpace(s)
	for _, layout := range []string{"20060102150405 -0700", "20060102150405-0700", "20060102150405", "200601021504"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Unix()
		}
	}
	return 0
}

// ParseXMLTV reads a guide (gzipped or not): the programmes from three
// hours before now to two days after, by channel id (lowercase), each
// channel's in order. Read as it comes: a guide can be hundreds of
// megabytes, of which this keeps the two days.
func ParseXMLTV(r io.Reader, now time.Time) (map[string][]Programme, error) {
	br := bufio.NewReaderSize(r, 64<<10)
	if head, err := br.Peek(2); err == nil && head[0] == 0x1f && head[1] == 0x8b {
		gz, err := gzip.NewReader(br)
		if err != nil {
			return nil, err
		}
		defer gz.Close()
		r = gz
	} else {
		r = br
	}
	from, to := now.Add(-3*time.Hour).Unix(), now.Add(48*time.Hour).Unix()
	out := map[string][]Programme{}
	d := xml.NewDecoder(r)
	d.Strict = false
	// Guides say their encoding; the text is taken as it is (UTF-8 mostly).
	d.CharsetReader = func(_ string, in io.Reader) (io.Reader, error) { return in, nil }
	var cur *Programme
	var channel, field string
	var text strings.Builder
	kept := 0
	for {
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			// What was read of a guide cut short still counts.
			if kept > 0 {
				break
			}
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "programme":
				cur, channel = &Programme{}, ""
				for _, a := range t.Attr {
					switch a.Name.Local {
					case "channel":
						channel = strings.ToLower(strings.TrimSpace(a.Value))
					case "start":
						cur.Start = xmltvTime(a.Value)
					case "stop":
						cur.Stop = xmltvTime(a.Value)
					}
				}
			case "title", "desc":
				field = t.Name.Local
				text.Reset()
			}
		case xml.CharData:
			if field != "" && text.Len() < 4096 {
				text.Write(t)
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "title":
				if cur != nil && cur.Title == "" {
					cur.Title = strings.TrimSpace(text.String())
				}
				field = ""
			case "desc":
				if cur != nil && cur.Desc == "" {
					cur.Desc = strings.TrimSpace(text.String())
					if len(cur.Desc) > 600 {
						cur.Desc = strings.ToValidUTF8(cur.Desc[:600], "") + "…"
					}
				}
				field = ""
			case "programme":
				if cur != nil && channel != "" && cur.Title != "" && cur.Stop > from && cur.Start < to {
					out[channel] = append(out[channel], *cur)
					kept++
				}
				cur = nil
			}
		}
	}
	for _, list := range out {
		sort.Slice(list, func(i, j int) bool { return list[i].Start < list[j].Start })
	}
	return out, nil
}

// nowNext are the programme on at t and the one after it.
func nowNext(list []Programme, t int64) (on, next *Programme) {
	for i := range list {
		p := &list[i]
		if p.Start <= t && t < p.Stop {
			on = p
		} else if p.Start > t {
			next = p
			break
		}
	}
	return on, next
}
