-- Penguin AI FAQ seed — generated from old bot config
-- Run: mysql -u ticketbot -p ticketbot < faq_seed.sql

INSERT INTO ai_faq (title, content, category, enabled) VALUES
  ('Anslutningsfel — Kunde inte ansluta till servern', 'Triggers: couldn''t connect, failed to get info, connection rejected

Lösningar:
- Kontrollera att servern är igång
- Verifiera att UDP-portarna är öppna
- Kontrollera din brandvägg
- Testa att pinga servern
- Kontrollera din internetanslutning', 'fivem', 1),
  ('UDP Anslutningsfel', 'Triggers: udp packets, allowing udp

Lösningar:
- Öppna nödvändiga UDP-portar i din router
- Kontrollera serverens brandväggsregler
- Verifiera att din ISP inte blockerar UDP-trafik
- Testa att tillfälligt inaktivera brandväggen', 'fivem', 1),
  ('FiveM Artifact Version Error — ESX kräver nyare version', 'Triggers: artifact version, requires a minimum, please update, esx

ESX kräver en nyare version av FiveM Artifact.
Lösningar:
- Uppdatera din FiveM Artifact version via Mod Manager
- Kontrollera ESX versionskraven
- Säkerställ att alla dependencies är uppdaterade
- Starta om FiveM efter uppdateringen', 'fivem', 1),
  ('Autentiseringsfel — Problem med inloggning till servern', 'Triggers: authentication failed, invalid token

Lösningar:
- Kontrollera dina inloggningsuppgifter
- Försök logga ut och in igen i FiveM
- Rensa din FiveM cache
- Kontakta server administratören', 'fivem', 1),
  ('Database Connection Error — No database selected', 'Triggers: no database selected, UnhandledPromiseRejectionWarning

Det verkar vara ett problem med databasen.
Lösningar:
- Kontrollera att databasens namn är korrekt angiven i mysql.cfg
- Gå till MySQL Panel (https://panel.penguinhosting.host/MySql) för att verifiera ditt databasnamn
- Lägg till ditt databasnamn i mysql.cfg under database=
- Om problemet kvarstår, kontakta en administratör
- YouTube guide: https://www.youtube.com/watch?v=2r6vY5XKlK8', 'fivem', 1),
  ('Skriptfel — Problem med server skript', 'Triggers: script error, failed to load, missing dependency

Lösningar:
- Kontrollera att alla required scripts är installerade
- Uppdatera dina skript
- Rensa din cache mapp
- Starta om FiveM klienten', 'fivem', 1),
  ('Server Full', 'Triggers: server is full, no available slots

Servern är full just nu.
Lösningar:
- Vänta tills en plats blir ledig
- Försök igen senare
- Kontrollera server status på Discord', 'fivem', 1),
  ('Flask Threading Error', 'Triggers: TypeError: ''handle'' must be a _ThreadHandle, threading.Thread.start

Lösningar:
- Starta om Flask-applikationen
- Kontrollera att alla nödvändiga paket är installerade: pip install flask watchdog
- Se till att du kör Python 3.7 eller senare
- Rensa alla temporära Python-filer (.pyc)
- Prova att köra Flask utan debug mode: debug=False', 'fivem', 1),
  ('Kan inte logga in på panel', 'Triggers: kan inte logga in, kan ej logga in

Hejsan! Kan du inte logga in på panelen?
- Gå till Password Recovery: https://panel.penguinhosting.host/Login/PasswordRecovery
- Om det inte fungerar, skapa ett support ticket eller kontakta LaGgIs.', 'panel', 1),
  ('txAdmin går inte att nå — ERR_CONNECTION_TIMED_OUT', 'Triggers: txadmin connection timed out, ERR_CONNECTION_TIMED_OUT, webbplatsen kan inte nås

Lösningar:
- Var säker på att du har startat servern via huvudpanelen
- Tryck på txAdmin-länken på huvudpanelen så du använder rätt domän', 'panel', 1),
  ('txAdmin — Glömt lösenord / Wrong username or password', 'Triggers: wrong username or password, txadmin password

Verkar som att du inte kan logga in på txAdmin.
Om du har glömt ditt lösenord kan du se det i Mod Manager under txAdmin Password Reset.', 'panel', 1),
  ('Fastnat / svävar i luften — kan inte röra sig', 'Triggers: sitter fast i luften, fastnat i luften, kan inte röra mig, svävar i luften, stuck

Lösningar:
1. Tryck F8 för att öppna konsolen och skriv /tp för att teleportera dig
2. Prova att logga ut och in igen på servern
3. Använd kommandot /respawn i chatten
4. Om inget annat fungerar, starta om din FiveM klient

Tips: Om problemet fortsätter, kontakta en administratör och spara gärna en skärmdump.', 'gameplay', 1),
  ('Gammal version av grunden — update via Mod Manager', 'Triggers: all (gamla versioner av grunden)

Det verkar som att du använder en gammal version av grunden.
Tryck Update i Mod Manager så ska det fungera igen.', 'fivem', 1),
  ('Valize grundens karaktärssystem', 'Triggers: valize karaktärssystem

Valize grundens karaktärssystem heter: klarserver_character', 'fivem', 1),
  ('Hälsningar och allmän hjälp', 'Triggers: hej, hallå, tjena, goddag, god morgon, god kväll, hjälp, help

Svara vänligt och fråga hur du kan hjälpa användaren.
Vanliga hälsningar: Hej! Hur kan jag hjälpa dig?
Om användaren säger hejdå: Ha en trevlig dag!', 'general', 1);
