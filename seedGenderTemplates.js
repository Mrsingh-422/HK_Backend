// seedGenderTemplates.js
const mongoose = require('mongoose');
const MasterReportTemplate = require('./models/MasterReportTemplate');
require('dotenv').config();

const updatedTemplates = [
  // =========================================================================
  // 1. COMPLETE BLOOD COUNT (CBC) - MALE & FEMALE
  // =========================================================================
  {
    testName: 'Complete Blood Count (CBC)',
    gender: 'Female',
    parameters: [
      { name: 'Haemoglobin (HB)', unit: 'g/dL', minRef: '12', maxRef: '15', type: 'numeric', method: 'Spectrophotometry', machine: 'Yumizen H2500', interpretation: 'BLOOD COUNTS: The cell morphology is well preserved for 24hrs. A direct smear is recommended for accurate differential count.' },
      { name: 'Red Blood Cell Count (RBC)', unit: '10^6/µl', minRef: '3.8', maxRef: '4.8', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Hematocrit (PCV)', unit: '%', minRef: '36', maxRef: '46', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Volume (MCV)', unit: 'fL', minRef: '83', maxRef: '101', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Hb (MCH)', unit: 'pg', minRef: '27', maxRef: '32', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Hb Conc (MCHC)', unit: 'g/dL', minRef: '31.5', maxRef: '34.5', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'RDW - CV', unit: '%', minRef: '11.6', maxRef: '14', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'RDW - SD', unit: 'fL', minRef: '39', maxRef: '46', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'Mentzer Index', unit: 'Ratio', minRef: '13', maxRef: '', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Total Leucocyte Count (TLC)', unit: '10^3/uL', minRef: '4', maxRef: '10', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Neutrophils', unit: '%', minRef: '40', maxRef: '80', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Lymphocytes', unit: '%', minRef: '20', maxRef: '40', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Monocytes', unit: '%', minRef: '2', maxRef: '10', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Eosinophils', unit: '%', minRef: '1', maxRef: '6', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Basophils', unit: '%', minRef: '', maxRef: '2', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Absolute Neutrophil Count (ANC)', unit: '10^3/uL', minRef: '2', maxRef: '7', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Lymphocyte Count (ALC)', unit: '10^3/uL', minRef: '1.4', maxRef: '3.5', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Monocyte Count', unit: '10^3/uL', minRef: '0.2', maxRef: '1', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Eosinophil Count (AEC)', unit: '10^3/uL', minRef: '0.04', maxRef: '0.44', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Basophil Count', unit: '10^3/uL', minRef: '', maxRef: '0.1', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Platelet Count (PLT)', unit: '10^3/µl', minRef: '150', maxRef: '410', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'MPV (Mean Platelet Volume)', unit: 'fL', minRef: '7', maxRef: '9', type: 'numeric', method: 'Derived from PLT Histogram', machine: 'Yumizen H2500' }
    ]
  },
  {
    testName: 'Complete Blood Count (CBC)',
    gender: 'Male',
    parameters: [
      { name: 'Haemoglobin (HB)', unit: 'g/dL', minRef: '13.0', maxRef: '17.0', type: 'numeric', method: 'Spectrophotometry', machine: 'Yumizen H2500', interpretation: 'BLOOD COUNTS: The cell morphology is well preserved for 24hrs. A direct smear is recommended for accurate differential count.' },
      { name: 'Red Blood Cell Count (RBC)', unit: '10^6/µl', minRef: '4.5', maxRef: '5.5', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Hematocrit (PCV)', unit: '%', minRef: '40', maxRef: '50', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Volume (MCV)', unit: 'fL', minRef: '83', maxRef: '101', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Hb (MCH)', unit: 'pg', minRef: '27', maxRef: '32', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Hb Conc (MCHC)', unit: 'g/dL', minRef: '31.5', maxRef: '34.5', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'RDW - CV', unit: '%', minRef: '11.6', maxRef: '14', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'RDW - SD', unit: 'fL', minRef: '39', maxRef: '46', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'Mentzer Index', unit: 'Ratio', minRef: '13', maxRef: '', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Total Leucocyte Count (TLC)', unit: '10^3/uL', minRef: '4', maxRef: '10', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Neutrophils', unit: '%', minRef: '40', maxRef: '80', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Lymphocytes', unit: '%', minRef: '20', maxRef: '40', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Monocytes', unit: '%', minRef: '2', maxRef: '10', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Eosinophils', unit: '%', minRef: '1', maxRef: '6', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Basophils', unit: '%', minRef: '', maxRef: '2', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Absolute Neutrophil Count (ANC)', unit: '10^3/uL', minRef: '2', maxRef: '7', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Lymphocyte Count (ALC)', unit: '10^3/uL', minRef: '1.4', maxRef: '3.5', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Monocyte Count', unit: '10^3/uL', minRef: '0.2', maxRef: '1', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Eosinophil Count (AEC)', unit: '10^3/uL', minRef: '0.04', maxRef: '0.44', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Basophil Count', unit: '10^3/uL', minRef: '', maxRef: '0.1', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Platelet Count (PLT)', unit: '10^3/µl', minRef: '150', maxRef: '410', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'MPV (Mean Platelet Volume)', unit: 'fL', minRef: '7', maxRef: '9', type: 'numeric', method: 'Derived from PLT Histogram', machine: 'Yumizen H2500' }
    ]
  },

  // =========================================================================
  // 2. LIVER FUNCTION TEST (LFT) - MALE & FEMALE
  // =========================================================================
  {
    testName: 'Liver Function Test (LFT)',
    gender: 'Female',
    parameters: [
      { name: 'Serum Bilirubin, (Total)', unit: 'mg/dl', minRef: '0.3', maxRef: '1.2', type: 'numeric', method: 'Diazonium Ion', machine: 'BECKMAN COULTER AU 5801', interpretation: 'Bilirubin is a yellowish pigment found in bile. Conjugated bilirubin is elevated in hepatitis, biliary obstruction, or structural liver blocks.' },
      { name: 'Serum Bilirubin, (Direct)', unit: 'mg/dl', minRef: '', maxRef: '0.2', type: 'numeric', method: 'Diazotization', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Bilirubin, (Indirect)', unit: 'mg/dl', minRef: '', maxRef: '0.8', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Aspartate Aminotransferase (AST/SGOT)', unit: 'U/L', minRef: '3.0', maxRef: '31', type: 'numeric', method: 'UV with P5P', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Alanine Aminotransferase (ALT/SGPT)', unit: 'U/L', minRef: '3', maxRef: '31', type: 'numeric', method: 'UV without P5P', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Alkaline Phosphatase (ALP)', unit: 'U/L', minRef: '33', maxRef: '98', type: 'numeric', method: 'IFCC AMP Buffer', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Gamma Glutamyl Transferase (GGT)', unit: 'U/L', minRef: '5', maxRef: '36', type: 'numeric', method: 'G-glutamyl-carboxy-IFCC', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Total Protein', unit: 'gm/dl', minRef: '6.6', maxRef: '8.3', type: 'numeric', method: 'Biuret', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Albumin', unit: 'g/dl', minRef: '3.5', maxRef: '5.2', type: 'numeric', method: 'Bromo Cresol Green(BCG)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Globulin', unit: 'gm/dl', minRef: '3', maxRef: '4.2', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Albumin/Globulin Ratio', unit: 'Ratio', minRef: '1.2', maxRef: '2.5', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'SGOT/SGPT Ratio', unit: 'Ratio', minRef: '0.7', maxRef: '1.4', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },
  {
    testName: 'Liver Function Test (LFT)',
    gender: 'Male',
    parameters: [
      { name: 'Serum Bilirubin, (Total)', unit: 'mg/dl', minRef: '0.3', maxRef: '1.2', type: 'numeric', method: 'Diazonium Ion', machine: 'BECKMAN COULTER AU 5801', interpretation: 'Bilirubin is a yellowish pigment found in bile. Conjugated bilirubin is elevated in hepatitis, biliary obstruction, or structural liver blocks.' },
      { name: 'Serum Bilirubin, (Direct)', unit: 'mg/dl', minRef: '', maxRef: '0.2', type: 'numeric', method: 'Diazotization', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Bilirubin, (Indirect)', unit: 'mg/dl', minRef: '', maxRef: '0.8', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Aspartate Aminotransferase (AST/SGOT)', unit: 'U/L', minRef: '3.0', maxRef: '35', type: 'numeric', method: 'UV with P5P', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Alanine Aminotransferase (ALT/SGPT)', unit: 'U/L', minRef: '3', maxRef: '35', type: 'numeric', method: 'UV without P5P', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Alkaline Phosphatase (ALP)', unit: 'U/L', minRef: '33', maxRef: '98', type: 'numeric', method: 'IFCC AMP Buffer', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Gamma Glutamyl Transferase (GGT)', unit: 'U/L', minRef: '8', maxRef: '61', type: 'numeric', method: 'G-glutamyl-carboxy-IFCC', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Total Protein', unit: 'gm/dl', minRef: '6.6', maxRef: '8.3', type: 'numeric', method: 'Biuret', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Albumin', unit: 'g/dl', minRef: '3.5', maxRef: '5.2', type: 'numeric', method: 'Bromo Cresol Green(BCG)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Globulin', unit: 'gm/dl', minRef: '3', maxRef: '4.2', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Albumin/Globulin Ratio', unit: 'Ratio', minRef: '1.2', maxRef: '2.5', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'SGOT/SGPT Ratio', unit: 'Ratio', minRef: '0.7', maxRef: '1.4', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },

  // =========================================================================
  // 3. KIDNEY FUNCTION TEST ADVANCE (KFT) - MALE & FEMALE
  // =========================================================================
  {
    testName: 'Kidney Function Test Advance (KFT)',
    gender: 'Female',
    parameters: [
      { name: 'Serum Creatinine', unit: 'mg/dl', minRef: '0.5', maxRef: '1.1', type: 'numeric', method: 'Jaffes Kinetic', machine: 'BECKMAN COULTER AU 5801', interpretation: 'Renal function evaluation is critical in identifying kidney disorders and monitoring filtration rate.' },
      { name: 'GFR, ESTIMATED', unit: 'mL/min/1.73m2', minRef: '90', maxRef: '150', type: 'numeric', method: 'Calculated (CKD-EPI)', machine: 'Calculated' },
      { name: 'Serum Uric Acid', unit: 'mg/dl', minRef: '2.6', maxRef: '6.0', type: 'numeric', method: 'Uricase', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Calcium', unit: 'mg/dl', minRef: '8.8', maxRef: '10.6', type: 'numeric', method: 'Arsenazo III', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Phosphorus', unit: 'mg/dl', minRef: '2.5', maxRef: '4.5', type: 'numeric', method: 'Phosphomolybdate', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Sodium', unit: 'mmol/L', minRef: '136', maxRef: '146', type: 'numeric', method: 'ISE (Indirect)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Chloride', unit: 'mmol/L', minRef: '101', maxRef: '109', type: 'numeric', method: 'ISE (Indirect)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Blood Urea', unit: 'mg/dl', minRef: '15', maxRef: '40', type: 'numeric', method: 'Urease', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Blood Urea Nitrogen (BUN)', unit: 'mg/dl', minRef: '7', maxRef: '18', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Bun/Creatinine Ratio', unit: 'Ratio', minRef: '10', maxRef: '20', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Urea/Creatinine Ratio', unit: 'Ratio', minRef: '20', maxRef: '30', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },
  {
    testName: 'Kidney Function Test Advance (KFT)',
    gender: 'Male',
    parameters: [
      { name: 'Serum Creatinine', unit: 'mg/dl', minRef: '0.7', maxRef: '1.3', type: 'numeric', method: 'Jaffes Kinetic', machine: 'BECKMAN COULTER AU 5801', interpretation: 'Renal function evaluation is critical in identifying kidney disorders and monitoring filtration rate.' },
      { name: 'GFR, ESTIMATED', unit: 'mL/min/1.73m2', minRef: '90', maxRef: '150', type: 'numeric', method: 'Calculated (CKD-EPI)', machine: 'Calculated' },
      { name: 'Serum Uric Acid', unit: 'mg/dl', minRef: '3.5', maxRef: '7.2', type: 'numeric', method: 'Uricase', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Calcium', unit: 'mg/dl', minRef: '8.8', maxRef: '10.6', type: 'numeric', method: 'Arsenazo III', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Phosphorus', unit: 'mg/dl', minRef: '2.5', maxRef: '4.5', type: 'numeric', method: 'Phosphomolybdate', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Sodium', unit: 'mmol/L', minRef: '136', maxRef: '146', type: 'numeric', method: 'ISE (Indirect)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Chloride', unit: 'mmol/L', minRef: '101', maxRef: '109', type: 'numeric', method: 'ISE (Indirect)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Blood Urea', unit: 'mg/dl', minRef: '17', maxRef: '43', type: 'numeric', method: 'Urease', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Blood Urea Nitrogen (BUN)', unit: 'mg/dl', minRef: '8', maxRef: '20', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Bun/Creatinine Ratio', unit: 'Ratio', minRef: '10', maxRef: '20', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Urea/Creatinine Ratio', unit: 'Ratio', minRef: '20', maxRef: '30', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },

  // =========================================================================
  // 4. LIPID PROFILE - MALE & FEMALE
  // =========================================================================
  {
    testName: 'Lipid Profile',
    gender: 'Female',
    parameters: [
      { name: 'Total Cholesterol', unit: 'mg/dL', minRef: '100', maxRef: '200', type: 'numeric', method: 'Cholesterol Oxidase', machine: 'BECKMAN COULTER AU 5801', interpretation: 'Dyslipidemia is a metabolic lipid disorder. High-Density Lipoprotein (HDL) carries protective benefits against Coronary Heart Disease.' },
      { name: 'Serum Triglycerides', unit: 'mg/dl', minRef: '50', maxRef: '150', type: 'numeric', method: 'Enzymatic', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum HDL Cholesterol', unit: 'mg/dl', minRef: '50', maxRef: '70', type: 'numeric', method: 'Direct measure', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'LDL Cholesterol', unit: 'mg/dl', minRef: '50', maxRef: '100', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'VLDL Cholesterol', unit: 'mg/dl', minRef: '5', maxRef: '30', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Total CHOL / HDL Cholesterol Ratio', unit: 'Ratio', minRef: '3.0', maxRef: '4.0', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'LDL / HDL Cholesterol Ratio', unit: 'Ratio', minRef: '0.5', maxRef: '2.5', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'HDL / LDL Cholesterol Ratio', unit: 'Ratio', minRef: '0.4', maxRef: '1.2', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Non-HDL Cholesterol', unit: 'mg/dl', minRef: '', maxRef: '150', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },
  {
    testName: 'Lipid Profile',
    gender: 'Male',
    parameters: [
      { name: 'Total Cholesterol', unit: 'mg/dL', minRef: '100', maxRef: '200', type: 'numeric', method: 'Cholesterol Oxidase', machine: 'BECKMAN COULTER AU 5801', interpretation: 'Dyslipidemia is a metabolic lipid disorder. High-Density Lipoprotein (HDL) carries protective benefits against Coronary Heart Disease.' },
      { name: 'Serum Triglycerides', unit: 'mg/dl', minRef: '50', maxRef: '150', type: 'numeric', method: 'Enzymatic', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum HDL Cholesterol', unit: 'mg/dl', minRef: '40', maxRef: '60', type: 'numeric', method: 'Direct measure', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'LDL Cholesterol', unit: 'mg/dl', minRef: '50', maxRef: '100', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'VLDL Cholesterol', unit: 'mg/dl', minRef: '5', maxRef: '30', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Total CHOL / HDL Cholesterol Ratio', unit: 'Ratio', minRef: '3.3', maxRef: '4.4', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'LDL / HDL Cholesterol Ratio', unit: 'Ratio', minRef: '0.5', maxRef: '3.0', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'HDL / LDL Cholesterol Ratio', unit: 'Ratio', minRef: '0.4', maxRef: '1.0', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Non-HDL Cholesterol', unit: 'mg/dl', minRef: '', maxRef: '160', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },

  // =========================================================================
  // 5. URINE ROUTINE & MICROSCOPY EXTENDED (COMMON TO BOTH)
  // =========================================================================
  {
    testName: 'Urine Routine & Microscopy Extended',
    gender: 'Both',
    parameters: [
      { name: 'Colour', unit: '', minRef: 'Pale Yellow', maxRef: '', type: 'numeric', method: 'Visual', machine: 'Visual Examination', interpretation: 'Urinalysis serves as a critical screening tool for renal, metabolic, and systemic disorders.' },
      { name: 'Volume', unit: 'mL', minRef: '10', maxRef: '', type: 'numeric', method: 'Visual', machine: 'Visual Examination' },
      { name: 'Appearance', unit: '', minRef: 'Clear', maxRef: '', type: 'numeric', method: 'Visual', machine: 'Visual Examination' },
      { name: 'Specific Gravity', unit: '', minRef: '1.001', maxRef: '1.035', type: 'numeric', method: 'Urometer', machine: 'Dipstick' },
      { name: 'pH', unit: '', minRef: '4.5', maxRef: '7.5', type: 'numeric', method: 'Double indicator', machine: 'Double indicator' },
      { name: 'Urine Protein', unit: '', minRef: 'Negative', maxRef: '', type: 'numeric', method: 'Dipstick', machine: 'Dipstick' },
      { name: 'Nitrite', unit: '', minRef: 'Negative', maxRef: '', type: 'numeric', method: 'Dipstick', machine: 'Dipstick' },
      { name: 'Pus Cells', unit: '/HPF', minRef: '', maxRef: '5', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' },
      { name: 'Epithelial cells', unit: '/HPF', minRef: '', maxRef: '5', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' },
      { name: 'RBCs', unit: '/HPF', minRef: 'Nil', maxRef: '', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' },
      { name: 'Casts', unit: '', minRef: 'Nil', maxRef: '', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' },
      { name: 'Crystals', unit: '', minRef: 'Nil', maxRef: '', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' },
      { name: 'Bacteria', unit: '', minRef: 'Absent', maxRef: '', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' }
    ]
  }
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB for Gender Templates Update...");
    for (const t of updatedTemplates) {
      await MasterReportTemplate.findOneAndUpdate(
        { testName: t.testName, gender: t.gender },
        { $set: t },
        { upsert: true, new: true }
      );
    }
    console.log("✅ All 5 Tests seeded with Male/Female/Both ranges successfully!");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

seed();