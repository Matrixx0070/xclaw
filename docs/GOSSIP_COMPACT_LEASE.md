# Compact lease (one gateway GCs a shard)

## Goal

Only one process should compact a given region shard.

## Design

- File or Redis lease `compact:{region}` TTL 15s
- Worker: acquire → compact → release

## Local today

- In-process coalesced queue + drain
