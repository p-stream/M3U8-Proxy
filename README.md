# M3U8-Proxy
Proxies m3u8 files through pure JavaScript.

## About
Some m3u8 files require special headers as well as CORS. This project achieves both by integrating Rob Wu's [CORS proxy](https://github.com/Rob--W/cors-anywhere) and adding a route to proxy m3u8 files.

## Features
- Proxies m3u8 and TS files with CORS support
- Automatically replaces URLs in m3u8 files to point to the proxy
- Supports custom headers for request authentication
- **IPv6 Address Rotation**: Route requests through different IPv6 addresses to avoid rate limiting and IP blocks

## Installation
1. Clone the repository.
```bash
git clone https://github.com/Eltik/M3U8-Proxy.git
```
2. Run `npm i`.
3. Run `npm run build`.
4. Run `npm start`.

You can configure how the proxy works via a `.env` file; it's relatively self-explanatory.
```
# This file is a template for .env file
# Copy this file to .env and change the values

# Web server configuration
HOST="localhost"
PORT="3030"

# Public URL to proxy ts files from
PUBLIC_URL="https://m3u8.eltik.net"

# IPv6 rotation configuration
USE_IPV6_ROTATION=false
IPV6_PREFIX=2001:db8
IPV6_SUBNET=1000
IPV6_INTERFACE=eth0
IPV6_POOL_SIZE=20
IPV6_POOL_INTERVAL=5000
IPV6_BATCH_SIZE=5
IPV6_DEBUG=false
```

## IPv6 Rotation
The proxy now supports IPv6 address rotation, which can help bypass rate limits and IP blocks. To use this feature:

1. Set `USE_IPV6_ROTATION=true` in your `.env` file
2. Configure your IPv6 prefix and subnet (typically provided by your ISP/hosting provider)
3. Set the correct network interface name
4. Adjust pool size and other parameters as needed

When enabled, the proxy will:
- Create a pool of random IPv6 addresses within your configured prefix/subnet
- Assign these addresses to your network interface
- Route outgoing requests through different IPv6 addresses in the pool
- Automatically manage the pool (add/remove addresses)

**Note**: IPv6 rotation requires root/administrator privileges on most systems to manage network interfaces.

You can check the status of the IPv6 pool using the `/ipv6-status` endpoint.

## Usage
To proxy m3u8 files, use the `/m3u8-proxy` route. All you have to do is input the URL and headers. For example:
```
http://localhost:3030/m3u8-proxy?url=https%3A%2F%2Fojkx.vizcloud.co%2Fsimple%2FEqPFJvsQWADtjDlGha7rC8UurFwHuLiwTk17rqk%2BwYMnU94US2El_Po4w12gXe6GptOSQtc%2Fbr%2Flist.m3u8%23.mp4&headers=%7B%22referer%22%3A%22https%3A%2F%2F9anime.pl%22%7D
```
The URL in this case is `https://ojkx.vizcloud.co/simple/EqPFJvsQWADtjDlGha7rC8UurFwHuLiwTk17rqk+wYMnU94US2El_Po4w12gXe6GptOSQtc/br/list.m3u8#.mp4` and the headers are `{"Referer": "https://9anime.pl"}`. This will then send a request to the m3u8 using the headers, modify the content to use the ts proxy, then proxy each ts file using a CORS proxy. If you need help, please join my [Discord](https://discord.gg/F87wYBtnkC).

## Credit
Inspired by [this](https://github.com/chaycee/M3U8Proxy) repository. I received some help from [chaycee](https://github.com/chaycee) as well. This project also uses code from [this CORS proxy](https://github.com/Rob--W/cors-anywhere).