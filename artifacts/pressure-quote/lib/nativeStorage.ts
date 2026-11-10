import AsyncStorage from '@react-native-async-storage/async-storage';
import { setStorageBackend } from './storage';

/** Connects the storage layer to the device's key-value store. Imported once, before anything reads or writes. */
setStorageBackend(AsyncStorage);
