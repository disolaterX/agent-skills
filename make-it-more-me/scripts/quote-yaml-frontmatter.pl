#!/usr/bin/env perl
#
# quote-yaml-frontmatter.pl — make at-risk top-level YAML front-matter values
# safe to parse, by wrapping them in double quotes.
#
# Why: replacing an em-dash with a colon inside an UNQUOTED front-matter value
# (e.g. `summary: built in Go: fast`) makes YAML read the tail as a nested key
# and the build fails. This quotes those values so the build stays green.
#
# Conservative by design: it only touches the FIRST front-matter block, only
# top-level keys, and SKIPS (and reports) anything it cannot safely quote rather
# than risk corrupting it. Idempotent. Preserves CRLF.
#
# Usage:  quote-yaml-frontmatter.pl FILE [FILE ...]
# Edits files in place. Run on committed files and rebuild afterwards.

use strict;
use warnings;

my $changed_total = 0;
my @skipped;

for my $file (@ARGV) {
    open(my $in, '<', $file) or do { warn "skip (open failed): $file\n"; next; };
    my @lines = <$in>;
    close($in);

    # Locate a COMPLETE front-matter block: an opening fence on line 1 AND a
    # closing fence below it. Without both, this isn't front-matter, so skip the
    # whole file rather than risk rewriting body lines (an unterminated `---`
    # must never bleed into prose).
    my $fence = qr/^---[ \t]*\r?\n?\z/;
    next unless @lines && $lines[0] =~ $fence;
    my $close;
    for my $i (1 .. $#lines) {
        if ($lines[$i] =~ $fence) { $close = $i; last; }
    }
    next unless defined $close;   # no closing fence => not real front-matter

    my $changed = 0;
    for my $i (1 .. $close - 1) {
        my $line = $lines[$i];

        # Preserve the original line ending (CRLF vs LF).
        my ($eol) = $line =~ /(\r?\n)\z/;
        $eol = '' unless defined $eol;
        (my $body = $line) =~ s/\r?\n\z//;

        # Top-level `key: value` only (no leading indentation = top level).
        # Key class allows digits and hyphens (pub-date, og-image, key_2 ...).
        next unless $body =~ /^([A-Za-z0-9_-]+):[ \t]+(.*\S)[ \t]*\z/;
        my ($key, $val) = ($1, $2);

        next unless $val =~ /: /;                 # only values YAML would misparse
        next if     $val =~ /^["'\[\{>|]/;        # already quoted / list / map / block scalar
        if ($val =~ / #/) {                       # looks like it carries a trailing comment
            push @skipped, "$file: $key  (contains ' #', possible comment — quote by hand)";
            next;
        }

        # Double-quote wrap. Escape backslash FIRST, then double-quote, so a
        # value with '\' or '"' stays valid; apostrophes need no escaping.
        (my $q = $val) =~ s/\\/\\\\/g;
        $q =~ s/"/\\"/g;
        $lines[$i] = "$key: \"$q\"$eol";
        $changed++;
    }

    if ($changed) {
        open(my $out, '>', $file) or do { warn "skip (write failed): $file\n"; next; };
        print $out @lines;
        close($out);
        $changed_total += $changed;
        print "fixed $changed value(s): $file\n";
    }
}

if (@skipped) {
    print "\nskipped (review by hand):\n  ", join("\n  ", @skipped), "\n";
}
print "done. $changed_total value(s) quoted.\n";
