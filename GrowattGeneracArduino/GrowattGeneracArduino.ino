#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoOTA.h>
#include <ArduinoJson.h>

// =========================================================
// ✅ USER CONFIGURABLE SETTINGS - PLACE YOUR VALUES HERE
// =========================================================

// Wi-Fi credentials
const char* ssid = "VPN";           // Your Wi-Fi network name
const char* password = "133Utica"; // Your Wi-Fi password

// Server details
const char* host = "node.johnetravels.com"; // Your Node.js server hostname or IP
const int httpsPort = 443;                  // Your server's HTTPS port (usually 443)

// ESP Device ID for this specific ESP (Matches ID in your Node.js database)
const int ESP_DEVICE_ID = 1; // ✅ IMPORTANT: Change this for each ESP device!

// Construct the full path with the device ID
String controlPath = "/espcontrol/device?deviceId=" + String(ESP_DEVICE_ID);

// SSL fingerprint (update if your server's SSL certificate changes)
// Use the fingerprint tool (e.g., https://www.grc.com/fingerprints.htm)
// Or get it from your browser's certificate info for your server's domain.
const char fingerprint[] = "56 99 84 58 27 EC DF D1 A1 A2 29 44 A3 E6 F1 0C 57 C7 CF B0";

// =========================================================
// END USER CONFIGURABLE SETTINGS
// =========================================================


// Control pin (D0 = GPIO16) - inverted logic for typical relays
const int pin = 16;

// Status LED pin (D1 = GPIO5)
const int ledPin = 5;

int failureCount = 0;

void blinkLED(int times, int delayMs = 200) {
  for (int i = 0; i < times; i++) {
    digitalWrite(ledPin, HIGH);
    delay(delayMs);
    digitalWrite(ledPin, LOW);
    delay(delayMs);
  }
}

void connectToWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected. IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi failed. Rebooting...");
    blinkLED(10, 100);
    ESP.restart();
  }
}

void setup() {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, HIGH);  // OFF (inverted logic for relay)

  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, LOW);

  Serial.begin(115200);
  delay(100);
  Serial.println("\nBooting...");

  blinkLED(3);
  connectToWiFi();

  ArduinoOTA.setHostname("esp8266-ota");
  ArduinoOTA.onStart([]() { Serial.println("OTA Start"); });
  ArduinoOTA.onEnd([]() { Serial.println("OTA End"); });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("OTA Error [%u]\n", error);
  });
  ArduinoOTA.begin();
  Serial.println("OTA Ready");
}

void loop() {
  ArduinoOTA.handle();

  WiFiClientSecure client;
  client.setFingerprint(fingerprint);

  if (!client.connect(host, httpsPort)) {
    Serial.println("HTTPS connection failed");
    blinkLED(2, 100);
    failureCount++;
    delay((failureCount >= 3) ? 10000 : 5000);
    return;
  }

  failureCount = 0;

  // Use the dynamically constructed controlPath
  client.print(String("GET ") + controlPath + " HTTP/1.1\r\n" +
               "Host: " + host + "\r\n" +
               "Connection: close\r\n\r\n");

  // Wait for the server to respond
  while (client.connected() && !client.available()) {
    delay(10);
  }

  // Read the entire HTTP response into a single string
  String fullResponse = "";
  while (client.connected() || client.available()) {
    if (client.available()) {
      fullResponse += (char)client.read();
    } else {
      delay(1);
    }
  }

  Serial.println("Received Full HTTP Response:");
  Serial.println(fullResponse);

  // Find the beginning of the JSON body by looking for the blank line after headers
  int bodyStartIndex = fullResponse.indexOf("\r\n\r\n");
  if (bodyStartIndex == -1) {
    Serial.println("Error: Could not find end of HTTP headers in response.");
    blinkLED(3, 100);
    client.stop();
    delay(2000);
    return;
  }

  // Extract the JSON body (starts 4 characters after "\r\n\r\n")
  String jsonResponse = fullResponse.substring(bodyStartIndex + 4);
  jsonResponse.trim();

  Serial.println("--- Extracted JSON Body ---");
  Serial.println(jsonResponse);

  StaticJsonDocument<200> doc;

  DeserializationError error = deserializeJson(doc, jsonResponse);

  if (error) {
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.f_str());
    blinkLED(3, 100);
    client.stop();
    delay(2000);
    return;
  }

  const char* state = doc["state"];

  if (state) {
    Serial.print("Extracted State: ");
    Serial.println(state);

    if (strcmp(state, "ON") == 0) {
      digitalWrite(pin, LOW); // Turn relay ON (inverted logic)
      Serial.println("Relay ON (D0)");
    } else if (strcmp(state, "OFF") == 0) {
      digitalWrite(pin, HIGH); // Turn relay OFF (inverted logic)
      Serial.println("Relay OFF (D0)");
    } else {
      Serial.println("Unknown state received: " + String(state));
    }
  } else {
    Serial.println("JSON 'state' key not found.");
  }

  client.stop();
  delay(2000);
}