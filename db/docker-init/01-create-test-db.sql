SELECT 'CREATE DATABASE beam_test OWNER beam_dev'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'beam_test')\gexec
