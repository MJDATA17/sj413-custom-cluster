/*
 * cluster_sensors.ino — Hub capteurs SJ413 (Arduino Nano) → L14 par USB série.
 *
 * Lit RPM (bobine via PC817), carburant + température (sondes résistives) et le
 * contact (ACC), et envoie en continu une ligne JSON au L14. L'Arduino n'envoie
 * que du BRUT (ohms / ADC) ; le L14 applique les courbes (config/sensors.json).
 *
 * Deux modes (constante USE_ADS1115) :
 *   0 = DÉGRADÉ  : carburant/température sur l'ADC natif 10 bits (A0/A1).
 *   1 = COMPLET  : carburant/température via ADS1115 I²C 16 bits (A0/A1 de l'ADS).
 * RPM et ACC sont identiques dans les deux modes. Le format série ne change pas.
 *
 * ⚠️ RPM : optocoupleur PC817 OBLIGATOIRE entre la bobine et D2 (pics 200–400 V).
 * Sortie : JSON \n @ 115200 baud, ~10 Hz. Masses communes Arduino/ADS/moteur.
 */

#define USE_ADS1115 0          // 0 = ADC natif (sans ADS1115) · 1 = ADS1115 I²C

/* ─── Broches ─── */
const uint8_t PIN_RPM  = 2;    // D2 (INT0) ← collecteur PC817
const uint8_t PIN_FUEL = A0;   // pont diviseur carburant (mode A)
const uint8_t PIN_TEMP = A1;   // pont diviseur température (mode A)
const uint8_t PIN_ACC  = A2;   // +12V contact divisé (toujours ADC natif)

/* ─── Ponts diviseurs (sonde ↔ GND, R_série ↔ Vsupply, point milieu lu) ─── */
const float R_SERIES_FUEL = 100.0;    // Ω
const float R_SERIES_TEMP = 1000.0;   // Ω
const float VSUPPLY        = 5.0;     // V (haut du pont)

/* ─── RPM ─── */
const uint16_t PULSES_PER_REV = 2;    // 4 cyl 4 temps = 2 imp/tour
const uint16_t RPM_WINDOW_MS  = 250;  // fenêtre de comptage
const float    RPM_SMOOTH     = 0.3;  // lissage (part de la nouvelle valeur)

/* ─── ACC (contact) ─── */
const float ACC_THRESHOLD_V = 1.5;    // > seuil = contact ON

/* ─── Sortie ─── */
const uint16_t SEND_MS = 100;         // ~10 Hz
const long     BAUDRATE = 115200;

#if USE_ADS1115
  #include <Wire.h>
  const uint8_t ADS_ADDR = 0x48;      // ADDR → GND
  const float   VREF    = 6.144;      // PGA ±6.144 V (pleine échelle, lit jusqu'à 5 V)
  const float   ADC_MAX = 32767.0;
#else
  const float   VREF    = 5.0;        // ADC natif = Vcc
  const float   ADC_MAX = 1023.0;
#endif

/* ─── RPM par interruption ─── */
volatile unsigned long pulseCount = 0;
void onPulse() { pulseCount++; }

/* ─── État ─── */
float rpm = 0;
float lastFuelOhm = 0, lastTempOhm = 0;
int   lastFuelRaw = 0, lastTempRaw = 0;
unsigned long lastRpmMs = 0, lastSendMs = 0;

#if USE_ADS1115
// Lecture single-ended ADS1115 (PGA ±6.144V, 128 SPS). Renvoie -1 si erreur I²C.
int16_t readADS(uint8_t ch) {
  uint16_t config = 0x8000                         // OS : démarre une conversion
                  | (((uint16_t)(0x4 | ch)) << 12) // MUX : single-ended AINch
                  | 0x0000                         // PGA : 000 = ±6.144V
                  | 0x0100                         // MODE : single-shot
                  | 0x0080                         // DR : 128 SPS
                  | 0x0003;                        // comparateur désactivé
  Wire.beginTransmission(ADS_ADDR);
  Wire.write(0x01); Wire.write(config >> 8); Wire.write(config & 0xFF);
  if (Wire.endTransmission() != 0) return -1;
  delay(9);                                        // ~1/128 s
  Wire.beginTransmission(ADS_ADDR); Wire.write(0x00); Wire.endTransmission();
  Wire.requestFrom((uint8_t)ADS_ADDR, (uint8_t)2);
  if (Wire.available() < 2) return -1;
  int16_t v = ((int16_t)Wire.read() << 8) | Wire.read();
  return v < 0 ? 0 : v;
}
#endif

// Lecture brute d'une voie carburant/temp selon le mode. ok=false si échec (mode B).
int readRaw(uint8_t nativePin, uint8_t adsCh, bool *ok) {
  *ok = true;
#if USE_ADS1115
  int16_t v = readADS(adsCh);
  if (v < 0) { *ok = false; return -1; }
  return v;
#else
  (void)adsCh;
  return analogRead(nativePin);
#endif
}

// Brut ADC → résistance sonde (Ω) via le pont diviseur.
float ohmFromRaw(int raw, float rSeries) {
  float v = raw * VREF / ADC_MAX;
  if (v >= VSUPPLY) return 1e9;            // sonde ouverte / hors plage
  if (v <= 0.001f) return 0.0;             // court-circuit
  return rSeries * v / (VSUPPLY - v);
}

void setup() {
  Serial.begin(BAUDRATE);
  pinMode(PIN_RPM, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_RPM), onPulse, FALLING);
#if USE_ADS1115
  Wire.begin();
#endif
}

void loop() {
  unsigned long now = millis();

  // ── RPM : fenêtre glissante + lissage ──
  if (now - lastRpmMs >= RPM_WINDOW_MS) {
    noInterrupts(); unsigned long p = pulseCount; pulseCount = 0; interrupts();
    float raw = (float)p * (60000.0 / RPM_WINDOW_MS) / PULSES_PER_REV;
    rpm += RPM_SMOOTH * (raw - rpm);
    if (rpm < 1) rpm = 0;
    lastRpmMs = now;
  }

  // ── Envoi périodique ──
  if (now - lastSendMs >= SEND_MS) {
    lastSendMs = now;
    uint8_t st = 0;

    bool okF, okT;
    int fuelRaw = readRaw(PIN_FUEL, 0, &okF);
    int tempRaw = readRaw(PIN_TEMP, 1, &okT);
    if (okF) { lastFuelRaw = fuelRaw; lastFuelOhm = ohmFromRaw(fuelRaw, R_SERIES_FUEL); st |= 0x1; }
    if (okT) { lastTempRaw = tempRaw; lastTempOhm = ohmFromRaw(tempRaw, R_SERIES_TEMP); st |= 0x2; }
    st |= 0x4;                               // RPM/système OK (l'interruption tourne toujours)

    float accV = analogRead(PIN_ACC) * 5.0 / 1023.0;   // ACC : ADC natif, ref 5V
    bool ign = accV > ACC_THRESHOLD_V;

    Serial.print(F("{\"rpm\":"));      Serial.print((long)(rpm + 0.5));
    Serial.print(F(",\"fuel_raw\":")); Serial.print(lastFuelRaw);
    Serial.print(F(",\"fuel_ohm\":")); Serial.print(lastFuelOhm, 1);
    Serial.print(F(",\"temp_raw\":")); Serial.print(lastTempRaw);
    Serial.print(F(",\"temp_ohm\":")); Serial.print(lastTempOhm, 1);
    Serial.print(F(",\"ign\":"));      Serial.print(ign ? 1 : 0);
    Serial.print(F(",\"st\":"));       Serial.print(st);
    Serial.print(F(",\"ms\":"));       Serial.print(now);
    Serial.println(F("}"));
  }
}
