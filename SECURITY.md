# Security policy

## Reporting a vulnerability

Please report it privately through GitHub: open this repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for it.

You'll hear back within a few days. The fix ships in a new release, and the advisory credits you unless you'd rather it didn't.

## Supported versions

Security fixes go into the latest release only.

## Scope

margins serves the folder you open on 127.0.0.1, and checks the `Host` header so a rebound DNS name can't reach it. The failures worth reporting are anything that lets a web page or a markdown file read or write outside that folder, run script in the page, or reach the server from another origin.
