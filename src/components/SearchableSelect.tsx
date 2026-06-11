// A bottom-sheet searchable dropdown used by the inspection wizard's
// Make / Model / Market-Spec fields (step 1 — Details).
//
// - Filter-as-you-type over a flat option list (optionally grouped by a
//   header that only shows while the search box is empty).
// - An optional "Other" row at the bottom opens a free-text input in the
//   caller, so anything not in the list can still be entered.
// - Display-only: every label here is passed in already-translated; the
//   `value` selected is the canonical English string the caller stores.
// - Matches DamagePicker's modal styling (slide-up sheet + scrim).

import { useEffect, useMemo, useState } from "react";
import {
  FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Icon } from "./Icon";
import { theme } from "../lib/theme";

export interface SelectOption {
  value: string;
  label: string;
  group?: string;       // optional section header (shown only when not searching)
  keywords?: string[];  // extra lowercase search terms (e.g. make aliases)
}

export function SearchableSelect({
  visible, title, options, searchPlaceholder, emptyLabel,
  otherLabel, selected, onSelect, onSelectOther, onClose,
}: {
  visible: boolean;
  title: string;
  options: SelectOption[];
  searchPlaceholder: string;
  emptyLabel: string;
  otherLabel?: string;        // when set, renders an "Other" row at the bottom
  selected?: string;
  onSelect: (value: string) => void;
  onSelectOther?: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  // Reset the search each time the sheet opens.
  useEffect(() => { if (visible) setQuery(""); }, [visible]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? options.filter(
            (o) =>
              o.label.toLowerCase().includes(q) ||
              o.value.toLowerCase().includes(q) ||
              o.keywords?.some((k) => k.includes(q) || q.includes(k)),
          )
        : options,
    [options, q],
  );

  if (!visible) return null;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <KeyboardAvoidingView
        style={styles.scrim}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Icon name="close" size={18} color={theme.colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <Icon name="search-outline" size={16} color={theme.colors.textLight} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={theme.colors.textLight}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Icon name="close-circle" size={16} color={theme.colors.textLight} />
              </Pressable>
            )}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(o, i) => `${o.value}::${i}`}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>{emptyLabel}</Text>}
            renderItem={({ item, index }) => {
              const isSelected = selected != null && item.value === selected;
              // Section header — only meaningful when not actively searching.
              const showGroup =
                !q && item.group != null && (index === 0 || filtered[index - 1].group !== item.group);
              return (
                <>
                  {showGroup && <Text style={styles.group}>{item.group}</Text>}
                  <Pressable
                    onPress={() => onSelect(item.value)}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  >
                    <Text style={[styles.rowText, isSelected && styles.rowTextSelected]} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {isSelected && <Icon name="checkmark" size={18} color={theme.colors.brand} />}
                  </Pressable>
                </>
              );
            }}
            ListFooterComponent={
              otherLabel && onSelectOther ? (
                <Pressable
                  onPress={onSelectOther}
                  style={({ pressed }) => [styles.row, styles.otherRow, pressed && styles.rowPressed]}
                >
                  <Icon name="create-outline" size={16} color={theme.colors.brand} />
                  <Text style={styles.otherText}>{otherLabel}</Text>
                </Pressable>
              ) : null
            }
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.colors.white,
    borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl,
    paddingTop: 16, maxHeight: "80%",
    ...Platform.select({ ios: { paddingBottom: 8 }, default: { paddingBottom: 0 } }),
  },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, marginBottom: 12 },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: theme.colors.text },
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bgAlt },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 12,
    height: 44, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.bgAlt,
  },
  searchInput: { flex: 1, fontSize: 15, color: theme.colors.text, paddingVertical: 0 },
  list: { paddingHorizontal: 12 },
  group: {
    fontSize: 10, fontWeight: "800", color: theme.colors.textLight,
    textTransform: "uppercase", letterSpacing: 0.6,
    paddingHorizontal: 8, paddingTop: 14, paddingBottom: 4,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 14, paddingHorizontal: 8, borderRadius: theme.radius.md,
  },
  rowPressed: { backgroundColor: theme.colors.brandLight },
  rowText: { flex: 1, fontSize: 15, color: theme.colors.text, fontWeight: "600" },
  rowTextSelected: { color: theme.colors.brand, fontWeight: "800" },
  otherRow: { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 4 },
  otherText: { flex: 1, fontSize: 15, color: theme.colors.brand, fontWeight: "800" },
  empty: { textAlign: "center", color: theme.colors.textLight, fontSize: 14, paddingVertical: 28 },
});
