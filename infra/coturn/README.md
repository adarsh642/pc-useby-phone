# coturn development notes

Use long-lived credentials only in local development. Production deployments must use
time-limited TURN credentials, TLS, firewall restrictions, and a public DNS name.
Never expose the admin/secret configuration in the Android app or Windows agent.
