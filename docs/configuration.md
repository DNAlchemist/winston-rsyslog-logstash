## Configuration

* `host`
    * The host location of the rsyslog server.
    * Default: `127.0.0.1`
* `tag`
    * Default: `apps`
* `port`
    * The host port to connect.
    * Default: `28777`
* `max_connect_retries`
    * Max number of attempts to reconnect to rsyslog before going into silence.
    * `-1` means retry forever.
    * Default: `4`
* `timeout_connect_retries`
    * The number of ms between each retry for a reconnect to rsyslog .
    * Default: `100`
* `rejectUnauthorized`
    * If true the server will reject any connection which is not authorized with the list of supplied CAs. 
    * Default true
* `strip_colors`
    * Strip colors from messages and metadata
    * Default: `false`
