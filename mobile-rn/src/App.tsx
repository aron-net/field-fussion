import React, { useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import auth from '@react-native-firebase/auth';
import { FieldFussionApiClient } from '../../src/shared/api/client';
import { calculateGeoJsonArea } from '../../src/shared/geo/area';
import { searchUgandaGazetteer } from '../../src/shared/geo/ugandaLocations';
import { getDictionary } from '../../src/shared/i18n/translations';
import type { FarmRecord, SupportedLanguage } from '../../src/shared/types/domain';

const COLORS = {
  primary: '#163D31',
  secondary: '#2D8A51',
  background: '#F5F7F1',
  surface: '#FFFFFF',
  border: '#DCE2D5',
  ink: '#13201B',
  muted: '#52635B',
};

export default function App() {
  const [language, setLanguage] = useState<SupportedLanguage>('en');
  const [status, setStatus] = useState<string>('Ready');
  const [farms, setFarms] = useState<FarmRecord[]>([]);
  const t = useMemo(() => getDictionary(language), [language]);
  const sampleDistricts = useMemo(() => searchUgandaGazetteer('Lira'), []);

  const apiClient = useMemo(
    () =>
      new FieldFussionApiClient(
        process.env.FIELD_FUSSION_API_URL || 'http://10.0.2.2:3000',
        async () => {
          const user = auth().currentUser;
          return user ? user.getIdToken() : null;
        }
      ),
    []
  );

  const checkSessionAndFarms = async () => {
    setStatus(t.common.loading);
    try {
      const session = await apiClient.getAuthSession();
      const farmsRes = await apiClient.listFarms();
      setFarms(farmsRes.data);
      setStatus(
        `Verified: ${session.data.user.email} · ${farmsRes.data.length} farm(s)`
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Sign-in required');
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.brand}>{t.brand.name}</Text>
          <Text style={styles.tagline}>{t.brand.tagline}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>React Native 0.86.2 + Re.Pack Target</Text>
          <Text style={styles.body}>
            Shares API contracts, Zod schemas, spherical GeoJSON area math, Uganda gazetteer ({sampleDistricts.length} matching hit for Lira), and {language.toUpperCase()} translations from src/shared/.
          </Text>
          <Text style={styles.status}>{status}</Text>

          <TouchableOpacity style={styles.button} onPress={checkSessionAndFarms}>
            <Text style={styles.buttonText}>Sync Session &amp; Farms</Text>
          </TouchableOpacity>
        </View>

        {farms.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t.farms.title}</Text>
            {farms.map((farm) => {
              const localArea = farm.boundaryGeojson
                ? calculateGeoJsonArea(farm.boundaryGeojson)
                : null;
              return (
                <View key={farm.id} style={styles.farmItem}>
                  <Text style={styles.farmName}>{farm.name}</Text>
                  <Text style={styles.body}>
                    {farm.district} · v{farm.version} ·{' '}
                    {farm.areaAcres !== null
                      ? `${farm.areaAcres.toFixed(2)} ac`
                      : localArea
                        ? `${localArea.areaAcres.toFixed(2)} ac`
                        : 'No boundary'}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.langRow}>
          {(['en', 'lg', 'sw'] as const).map((code) => (
            <TouchableOpacity
              key={code}
              style={[
                styles.langBtn,
                language === code && styles.langBtnActive,
              ]}
              onPress={() => setLanguage(code)}
            >
              <Text
                style={[
                  styles.langText,
                  language === code && styles.langTextActive,
                ]}
              >
                {code.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  container: { padding: 16, gap: 16 },
  header: { paddingVertical: 8 },
  brand: { fontSize: 22, fontWeight: '700', color: COLORS.primary },
  tagline: { fontSize: 13, color: COLORS.secondary, marginTop: 2 },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: COLORS.ink },
  body: { fontSize: 14, color: COLORS.muted, lineHeight: 20 },
  status: { fontSize: 12, color: COLORS.primary, fontWeight: '500' },
  farmItem: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 2,
  },
  farmName: { fontSize: 14, fontWeight: '600', color: COLORS.ink },
  button: {
    minHeight: 44,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  langRow: { flexDirection: 'row', gap: 8 },
  langBtn: {
    minHeight: 44,
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  langText: { fontSize: 13, fontWeight: '600', color: COLORS.ink },
  langTextActive: { color: '#FFFFFF' },
});
