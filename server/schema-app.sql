-- DocDesk Database Schema (prefixed with app_ to avoid conflicts)

-- Users table
CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'doctor', 'receptionist')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Patients table
CREATE TABLE IF NOT EXISTS app_patients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  age INTEGER,
  gender VARCHAR(10),
  contact VARCHAR(20),
  address TEXT,
  medical_history TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Appointments table
CREATE TABLE IF NOT EXISTS app_appointments (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER REFERENCES app_patients(id) ON DELETE CASCADE,
  doctor_id INTEGER REFERENCES app_users(id),
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Documents table
CREATE TABLE IF NOT EXISTS app_documents (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER REFERENCES app_patients(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES app_users(id),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_app_appointments_patient ON app_appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_app_appointments_doctor ON app_appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_app_appointments_date ON app_appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_app_documents_patient ON app_documents(patient_id);
