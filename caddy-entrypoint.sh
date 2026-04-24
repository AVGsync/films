#!/bin/sh
set -eu

find_cert_file() {
	for path in \
		/certs/fullchain.pem \
		/certs/cert.pem \
		/certs/ruwcdymvkbox.duckdns.org.cer \
		/certs/*.cer \
		/certs/fullchain.crt \
		/certs/tls.crt
	do
		if [ -f "$path" ]; then
			echo "$path"
			return 0
		fi
	done

	find /certs -type f \( -name 'fullchain.pem' -o -name 'cert.pem' -o -name '*.cer' -o -name 'fullchain.crt' -o -name 'tls.crt' \) | head -n 1
}

find_key_file() {
	for path in \
		/certs/key.pem \
		/certs/privkey.pem \
		/certs/ruwcdymvkbox.duckdns.org.cer.key \
		/certs/*.cer.key \
		/certs/tls.key
	do
		if [ -f "$path" ]; then
			echo "$path"
			return 0
		fi
	done

	find /certs -type f \( -name 'key.pem' -o -name 'privkey.pem' -o -name '*.cer.key' -o -name 'tls.key' -o -name '*.key' \) | head -n 1
}

CERT_FILE="${CERT_FILE:-$(find_cert_file || true)}"
KEY_FILE="${KEY_FILE:-$(find_key_file || true)}"
FILMS_DOMAIN="${FILMS_DOMAIN:-ruwcdymvkbox.duckdns.org}"

if [ -z "$CERT_FILE" ] || [ ! -f "$CERT_FILE" ]; then
	echo "Certificate file not found under /certs" >&2
	find /certs -maxdepth 4 -print >&2 || true
	exit 1
fi

if [ -z "$KEY_FILE" ] || [ ! -f "$KEY_FILE" ]; then
	echo "Key file not found under /certs" >&2
	find /certs -maxdepth 4 -print >&2 || true
	exit 1
fi

export CERT_FILE
export KEY_FILE
export FILMS_DOMAIN

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
