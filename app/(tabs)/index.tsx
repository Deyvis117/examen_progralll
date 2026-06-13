import { Ionicons } from '@expo/vector-icons';
import { setNotificationHandler } from 'expo-notifications/build/NotificationsHandler';
import scheduleNotificationAsync from 'expo-notifications/build/scheduleNotificationAsync';
import * as SQLite from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type Priority = 'Alta' | 'Media' | 'Baja';

type Task = {
  id: number;
  title: string;
  description: string;
  due_date: string;
  priority: Priority;
  completed: number;
  created_at: string;
};

const priorities: Priority[] = ['Alta', 'Media', 'Baja'];
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('tareas.db').catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

function hasValidId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

const priorityColors: Record<Priority, { background: string; text: string; dot: string }> = {
  Alta: { background: '#FEE2E2', text: '#B91C1C', dot: '#EF4444' },
  Media: { background: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
  Baja: { background: '#DCFCE7', text: '#166534', dot: '#22C55E' },
};

export default function HomeScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('Media');

  const loadTasks = useCallback(async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<Task>(
      'SELECT * FROM tasks ORDER BY completed ASC, id DESC'
    );
    setTasks(rows);
  }, []);

  useEffect(() => {
    const initialize = async () => {
      try {
        const db = await getDatabase();
        await db.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            due_date TEXT NOT NULL DEFAULT '',
            priority TEXT NOT NULL DEFAULT 'Media',
            completed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          );
        `);
        await loadTasks();
      } catch (error) {
        showError('No fue posible iniciar la aplicación.', error);
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [loadTasks]);

  const pendingCount = useMemo(
    () => tasks.filter((task) => task.completed === 0).length,
    [tasks]
  );

  const resetForm = () => {
    setEditingTask(null);
    setTitle('');
    setDescription('');
    setDueDate('');
    setPriority('Media');
  };

  const openCreateModal = () => {
    resetForm();
    setModalVisible(true);
  };

  const openEditModal = (task: Task) => {
    if (!hasValidId(task.id)) {
      Alert.alert('Tarea inválida', 'No se puede editar una tarea sin un ID válido.');
      return;
    }

    setEditingTask(task);
    setTitle(task.title);
    setDescription(task.description);
    setDueDate(task.due_date);
    setPriority(task.priority);
    setModalVisible(true);
  };

  const closeModal = () => {
    if (!saving) {
      setModalVisible(false);
      resetForm();
    }
  };

  const saveTask = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      Alert.alert('Título requerido', 'Escribe un título para guardar la tarea.');
      return;
    }

    setSaving(true);
    try {
      const db = await getDatabase();
      if (editingTask) {
        if (!hasValidId(editingTask.id)) {
          Alert.alert('Tarea inválida', 'No se puede actualizar una tarea sin un ID válido.');
          return;
        }

        await db.runAsync(
          `UPDATE tasks
           SET title = ?, description = ?, due_date = ?, priority = ?
           WHERE id = ?`,
          [cleanTitle, description.trim(), dueDate.trim(), priority, editingTask.id]
        );
        await sendLocalNotification('Tarea actualizada', `Actualizaste: ${cleanTitle}`);
      } else {
        await db.runAsync(
          `INSERT INTO tasks (title, description, due_date, priority, completed, created_at)
           VALUES (?, ?, ?, ?, 0, ?)`,
          [cleanTitle, description.trim(), dueDate.trim(), priority, new Date().toISOString()]
        );
        await sendLocalNotification('Nueva tarea creada', `Agregaste: ${cleanTitle}`);
      }

      await loadTasks();
      setModalVisible(false);
      resetForm();
    } catch (error) {
      showError('No fue posible guardar la tarea.', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleCompleted = async (task: Task) => {
    if (!hasValidId(task.id)) {
      Alert.alert('Tarea inválida', 'No se puede actualizar una tarea sin un ID válido.');
      return;
    }

    try {
      const db = await getDatabase();
      await db.runAsync('UPDATE tasks SET completed = ? WHERE id = ?', [
        task.completed ? 0 : 1,
        task.id,
      ]);
      await loadTasks();
    } catch (error) {
      showError('No fue posible actualizar el estado.', error);
    }
  };

  const deleteTask = (task: Task) => {
    if (!hasValidId(task.id)) {
      Alert.alert('Tarea inválida', 'No se puede eliminar una tarea sin un ID válido.');
      return;
    }

    Alert.alert('Eliminar tarea', `¿Deseas eliminar "${task.title}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            const db = await getDatabase();
            await db.runAsync('DELETE FROM tasks WHERE id = ?', [task.id]);
            await loadTasks();
          } catch (error) {
            showError('No fue posible eliminar la tarea.', error);
          }
        },
      },
    ]);
  };

  const renderTask = ({ item }: { item: Task }) => {
    const colors = priorityColors[item.priority] ?? priorityColors.Media;

    return (
      <View style={[styles.taskCard, item.completed === 1 && styles.taskCardCompleted]}>
        <Pressable
          accessibilityLabel={item.completed ? 'Marcar como pendiente' : 'Marcar como completada'}
          onPress={() => toggleCompleted(item)}
          style={[styles.checkbox, item.completed === 1 && styles.checkboxCompleted]}>
          {item.completed === 1 && <Ionicons name="checkmark" size={17} color="#FFFFFF" />}
        </Pressable>

        <View style={styles.taskContent}>
          <View style={styles.taskTitleRow}>
            <Text
              numberOfLines={2}
              style={[styles.taskTitle, item.completed === 1 && styles.completedText]}>
              {item.title}
            </Text>
            <View style={[styles.priorityBadge, { backgroundColor: colors.background }]}>
              <View style={[styles.priorityDot, { backgroundColor: colors.dot }]} />
              <Text style={[styles.priorityText, { color: colors.text }]}>{item.priority}</Text>
            </View>
          </View>

          {!!item.description && (
            <Text
              numberOfLines={3}
              style={[styles.taskDescription, item.completed === 1 && styles.completedText]}>
              {item.description}
            </Text>
          )}

          <View style={styles.taskFooter}>
            <View style={styles.dateContainer}>
              <Ionicons name="calendar-outline" size={15} color="#64748B" />
              <Text style={styles.dateText}>{item.due_date || 'Sin fecha definida'}</Text>
            </View>
            <View style={styles.actions}>
              <Pressable
                accessibilityLabel="Editar tarea"
                onPress={() => openEditModal(item)}
                style={styles.iconButton}>
                <Ionicons name="pencil-outline" size={19} color="#4F46E5" />
              </Pressable>
              <Pressable
                accessibilityLabel="Eliminar tarea"
                onPress={() => deleteTask(item)}
                style={[styles.iconButton, styles.deleteButton]}>
                <Ionicons name="trash-outline" size={19} color="#DC2626" />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerGlow} />
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.eyebrow}>MI ORGANIZADOR</Text>
              <Text style={styles.headerTitle}>Tareas y actividades</Text>
              <Text style={styles.headerSubtitle}>
                {pendingCount === 0
                  ? 'Todo listo por ahora'
                  : `${pendingCount} ${pendingCount === 1 ? 'tarea pendiente' : 'tareas pendientes'}`}
              </Text>
            </View>
            <View style={styles.headerIcon}>
              <Ionicons name="notifications-outline" size={25} color="#FFFFFF" />
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Mis tareas</Text>
              <Text style={styles.sectionSubtitle}>{tasks.length} registradas en SQLite</Text>
            </View>
            <Pressable onPress={openCreateModal} style={styles.addButton}>
              <Ionicons name="add" size={21} color="#FFFFFF" />
              <Text style={styles.addButtonText}>Nueva</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color="#4F46E5" />
              <Text style={styles.stateText}>Preparando tus tareas...</Text>
            </View>
          ) : (
            <FlatList
              contentContainerStyle={tasks.length === 0 ? styles.emptyList : styles.list}
              data={tasks}
              keyExtractor={(item) => item.id.toString()}
              ListEmptyComponent={
                <View style={styles.emptyCard}>
                  <View style={styles.emptyIcon}>
                    <Ionicons name="checkmark-done-outline" size={38} color="#4F46E5" />
                  </View>
                  <Text style={styles.emptyTitle}>Tu lista está vacía</Text>
                  <Text style={styles.emptyText}>
                    Crea una tarea para comenzar a organizar tus actividades.
                  </Text>
                  <Pressable onPress={openCreateModal} style={styles.emptyButton}>
                    <Text style={styles.emptyButtonText}>Crear primera tarea</Text>
                  </Pressable>
                </View>
              }
              renderItem={renderTask}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>

      <Modal
        animationType="slide"
        onRequestClose={closeModal}
        presentationStyle="pageSheet"
        transparent={Platform.OS === 'android'}
        visible={modalVisible}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>
                  {editingTask ? 'Editar tarea' : 'Nueva tarea'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {editingTask ? 'Actualiza los detalles de tu actividad' : 'Organiza tu próxima actividad'}
                </Text>
              </View>
              <Pressable onPress={closeModal} style={styles.closeButton}>
                <Ionicons name="close" size={22} color="#334155" />
              </Pressable>
            </View>

            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>Título *</Text>
                <TextInput
                  autoFocus
                  maxLength={80}
                  onChangeText={setTitle}
                  placeholder="Ej. Entregar proyecto final"
                  placeholderTextColor="#94A3B8"
                  style={styles.input}
                  value={title}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Descripción</Text>
                <TextInput
                  maxLength={250}
                  multiline
                  onChangeText={setDescription}
                  placeholder="Agrega detalles importantes..."
                  placeholderTextColor="#94A3B8"
                  style={[styles.input, styles.textArea]}
                  textAlignVertical="top"
                  value={description}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Fecha o recordatorio</Text>
                <View style={styles.inputWithIcon}>
                  <Ionicons name="calendar-outline" size={19} color="#64748B" />
                  <TextInput
                    maxLength={50}
                    onChangeText={setDueDate}
                    placeholder="Ej. Viernes, 4:00 PM"
                    placeholderTextColor="#94A3B8"
                    style={styles.inputInner}
                    value={dueDate}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Prioridad</Text>
                <View style={styles.priorityOptions}>
                  {priorities.map((item) => {
                    const colors = priorityColors[item];
                    const selected = priority === item;
                    return (
                      <Pressable
                        key={item}
                        onPress={() => setPriority(item)}
                        style={[
                          styles.priorityOption,
                          selected && {
                            backgroundColor: colors.background,
                            borderColor: colors.dot,
                          },
                        ]}>
                        <View style={[styles.priorityDot, { backgroundColor: colors.dot }]} />
                        <Text style={[styles.priorityOptionText, selected && { color: colors.text }]}>
                          {item}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={styles.modalActions}>
              <Pressable disabled={saving} onPress={closeModal} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable disabled={saving} onPress={saveTask} style={styles.saveButton}>
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name={editingTask ? 'save-outline' : 'add'} size={20} color="#FFFFFF" />
                    <Text style={styles.saveButtonText}>
                      {editingTask ? 'Guardar cambios' : 'Crear tarea'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

async function sendLocalNotification(title: string, body: string) {
  if (Platform.OS === 'web') return;

  try {
    await scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
      },
      trigger: null,
    });
  } catch (error) {
    console.warn('No fue posible mostrar la notificación local.', error);
  }
}

function showError(message: string, error: unknown) {
  console.error(message, error);
  Alert.alert('Ocurrió un error', message);
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#3730A3' },
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    backgroundColor: '#4F46E5',
    overflow: 'hidden',
    paddingBottom: 30,
    paddingHorizontal: 22,
    paddingTop: Platform.OS === 'android' ? 46 : 24,
  },
  headerGlow: {
    backgroundColor: '#818CF8',
    borderRadius: 100,
    height: 190,
    opacity: 0.35,
    position: 'absolute',
    right: -65,
    top: -100,
    width: 190,
  },
  headerTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  eyebrow: { color: '#C7D2FE', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  headerTitle: { color: '#FFFFFF', fontSize: 25, fontWeight: '800', marginTop: 5 },
  headerSubtitle: { color: '#E0E7FF', fontSize: 14, marginTop: 6 },
  headerIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 18,
    borderWidth: 1,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  content: { flex: 1, marginTop: -12 },
  sectionHeader: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 18,
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  sectionTitle: { color: '#0F172A', fontSize: 20, fontWeight: '800' },
  sectionSubtitle: { color: '#64748B', fontSize: 12, marginTop: 3 },
  addButton: {
    alignItems: 'center',
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  list: { gap: 12, paddingBottom: 100, paddingHorizontal: 16, paddingTop: 4 },
  emptyList: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  centerState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
  stateText: { color: '#64748B', fontSize: 14 },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 22,
    borderWidth: 1,
    padding: 28,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    marginBottom: 16,
    width: 60,
  },
  emptyTitle: { color: '#0F172A', fontSize: 18, fontWeight: '800' },
  emptyText: { color: '#64748B', lineHeight: 20, marginTop: 7, textAlign: 'center' },
  emptyButton: {
    backgroundColor: '#EEF2FF',
    borderRadius: 11,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  emptyButtonText: { color: '#4338CA', fontWeight: '700' },
  taskCard: {
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 15,
  },
  taskCardCompleted: { backgroundColor: '#F8FAFC', opacity: 0.75 },
  checkbox: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 2,
    height: 25,
    justifyContent: 'center',
    marginTop: 1,
    width: 25,
  },
  checkboxCompleted: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  taskContent: { flex: 1 },
  taskTitleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  taskTitle: { color: '#0F172A', flex: 1, fontSize: 16, fontWeight: '800', lineHeight: 21 },
  completedText: { color: '#94A3B8', textDecorationLine: 'line-through' },
  priorityBadge: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  priorityDot: { borderRadius: 4, height: 7, width: 7 },
  priorityText: { fontSize: 10, fontWeight: '800' },
  taskDescription: { color: '#64748B', fontSize: 13, lineHeight: 19, marginTop: 7 },
  taskFooter: {
    alignItems: 'center',
    borderTopColor: '#F1F5F9',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
  },
  dateContainer: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 5 },
  dateText: { color: '#64748B', flex: 1, fontSize: 11 },
  actions: { flexDirection: 'row', gap: 7 },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 9,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  deleteButton: { backgroundColor: '#FEF2F2' },
  modalBackdrop: {
    backgroundColor: Platform.OS === 'android' ? 'rgba(15,23,42,0.55)' : '#FFFFFF',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    maxHeight: '96%',
    paddingBottom: Platform.OS === 'ios' ? 28 : 20,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: '#CBD5E1',
    borderRadius: 3,
    height: 5,
    marginBottom: 18,
    width: 44,
  },
  modalHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  modalTitle: { color: '#0F172A', fontSize: 23, fontWeight: '800' },
  modalSubtitle: { color: '#64748B', fontSize: 12, marginTop: 4 },
  closeButton: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  form: { gap: 16 },
  field: { gap: 7 },
  label: { color: '#334155', fontSize: 13, fontWeight: '700' },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0F172A',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textArea: { height: 82 },
  inputWithIcon: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 14,
  },
  inputInner: { color: '#0F172A', flex: 1, fontSize: 14, paddingVertical: 12 },
  priorityOptions: { flexDirection: 'row', gap: 8 },
  priorityOption: {
    alignItems: 'center',
    borderColor: '#E2E8F0',
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 11,
  },
  priorityOptionText: { color: '#64748B', fontSize: 12, fontWeight: '700' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 24 },
  cancelButton: {
    alignItems: 'center',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 13,
  },
  cancelButtonText: { color: '#475569', fontSize: 14, fontWeight: '700' },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    flex: 1.7,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  saveButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
