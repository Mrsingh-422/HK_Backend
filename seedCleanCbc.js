// seedAllGenderTemplates.js
const mongoose = require('mongoose');
const MasterReportTemplate = require('./models/MasterReportTemplate');
require('dotenv').config();

const fullCatalogTemplates = [
  // =========================================================================
  // 1. COMPLETE BLOOD COUNT (CBC) - FEMALE & MALE
  // =========================================================================
  {
    testName: 'Complete Blood Count (CBC)',
    gender: 'Female',
    parameters: [
      {
        name: 'Haemoglobin (HB)',
        unit: 'g/dL',
        minRef: '12',
        maxRef: '15',
        gender: 'Female',
        type: 'numeric',
        method: 'Spectrophotometry',
        machine: 'Yumizen H2500',
        interpretation: 'BLOOD COUNTS: The cell morphology is well preserved for 24hrs. A direct smear is recommended for an accurate differential count and examination of RBC morphology.'
      },
      { name: 'Red Blood Cell Count (RBC)', unit: '10^6/uL', minRef: '3.8', maxRef: '4.8', gender: 'Female', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Hematocrit (PCV)', unit: '%', minRef: '36', maxRef: '46', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Volume (MCV)', unit: 'fL', minRef: '83', maxRef: '101', gender: 'Female', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Hb (MCH)', unit: 'pg', minRef: '27', maxRef: '32', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Hb Conc (MCHC)', unit: 'g/dL', minRef: '31.5', maxRef: '34.5', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'RDW - CV', unit: '%', minRef: '11.6', maxRef: '14', gender: 'Female', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'RDW - SD', unit: 'fL', minRef: '39', maxRef: '46', gender: 'Female', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'Mentzer Index', unit: 'Ratio', minRef: '13', maxRef: '', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Total Leucocyte Count (TLC)', unit: '10^3/uL', minRef: '4', maxRef: '10', gender: 'Female', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Neutrophils', unit: '%', minRef: '40', maxRef: '80', gender: 'Female', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Lymphocytes', unit: '%', minRef: '20', maxRef: '40', gender: 'Female', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Monocytes', unit: '%', minRef: '2', maxRef: '10', gender: 'Female', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Eosinophils', unit: '%', minRef: '1', maxRef: '6', gender: 'Female', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Basophils', unit: '%', minRef: '', maxRef: '2', gender: 'Female', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Absolute Neutrophil Count (ANC)', unit: '10^3/uL', minRef: '2', maxRef: '7', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Lymphocyte Count (ALC)', unit: '10^3/uL', minRef: '1.4', maxRef: '3.5', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Monocyte Count', unit: '10^3/uL', minRef: '0.2', maxRef: '1', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Eosinophil Count (AEC)', unit: '10^3/uL', minRef: '0.04', maxRef: '0.44', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Basophil Count', unit: '10^3/uL', minRef: '', maxRef: '0.1', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Platelet Count (PLT)', unit: '10^3/uL', minRef: '150', maxRef: '410', gender: 'Female', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'MPV (Mean Platelet Volume)', unit: 'fL', minRef: '7', maxRef: '9', gender: 'Female', type: 'numeric', method: 'Derived from PLT Histogram', machine: 'Yumizen H2500' }
    ]
  },
  {
    testName: 'Complete Blood Count (CBC)',
    gender: 'Male',
    parameters: [
      {
        name: 'Haemoglobin (HB)',
        unit: 'g/dL',
        minRef: '13.0',
        maxRef: '17.0',
        gender: 'Male',
        type: 'numeric',
        method: 'Spectrophotometry',
        machine: 'Yumizen H2500',
        interpretation: 'BLOOD COUNTS: The cell morphology is well preserved for 24hrs. A direct smear is recommended for an accurate differential count and examination of RBC morphology.'
      },
      { name: 'Red Blood Cell Count (RBC)', unit: '10^6/uL', minRef: '4.5', maxRef: '5.5', gender: 'Male', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Hematocrit (PCV)', unit: '%', minRef: '40', maxRef: '50', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Volume (MCV)', unit: 'fL', minRef: '83', maxRef: '101', gender: 'Male', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Hb (MCH)', unit: 'pg', minRef: '27', maxRef: '32', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'Mean Corp Hb Conc (MCHC)', unit: 'g/dL', minRef: '31.5', maxRef: '34.5', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Yumizen H2500' },
      { name: 'RDW - CV', unit: '%', minRef: '11.6', maxRef: '14', gender: 'Male', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'RDW - SD', unit: 'fL', minRef: '39', maxRef: '46', gender: 'Male', type: 'numeric', method: 'Derived from RBC Histogram', machine: 'Yumizen H2500' },
      { name: 'Mentzer Index', unit: 'Ratio', minRef: '13', maxRef: '', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Total Leucocyte Count (TLC)', unit: '10^3/uL', minRef: '4', maxRef: '10', gender: 'Male', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Neutrophils', unit: '%', minRef: '40', maxRef: '80', gender: 'Male', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Lymphocytes', unit: '%', minRef: '20', maxRef: '40', gender: 'Male', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Monocytes', unit: '%', minRef: '2', maxRef: '10', gender: 'Male', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Eosinophils', unit: '%', minRef: '1', maxRef: '6', gender: 'Male', type: 'numeric', method: 'Flow-Cytometry DHSS', machine: 'Yumizen H2500' },
      { name: 'Basophils', unit: '%', minRef: '', maxRef: '2', gender: 'Male', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'Absolute Neutrophil Count (ANC)', unit: '10^3/uL', minRef: '2', maxRef: '7', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Lymphocyte Count (ALC)', unit: '10^3/uL', minRef: '1.4', maxRef: '3.5', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Monocyte Count', unit: '10^3/uL', minRef: '0.2', maxRef: '1', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Eosinophil Count (AEC)', unit: '10^3/uL', minRef: '0.04', maxRef: '0.44', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Absolute Basophil Count', unit: '10^3/uL', minRef: '', maxRef: '0.1', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Platelet Count (PLT)', unit: '10^3/uL', minRef: '150', maxRef: '410', gender: 'Male', type: 'numeric', method: 'Impedance', machine: 'Yumizen H2500' },
      { name: 'MPV (Mean Platelet Volume)', unit: 'fL', minRef: '7', maxRef: '9', gender: 'Male', type: 'numeric', method: 'Derived from PLT Histogram', machine: 'Yumizen H2500' }
    ]
  },

  // =========================================================================
  // 2. LIVER FUNCTION TEST (LFT) - FEMALE & MALE
  // =========================================================================
  {
    testName: 'Liver Function Test (LFT)',
    gender: 'Female',
    parameters: [
      {
        name: 'Serum Bilirubin, (Total)',
        unit: 'mg/dl',
        minRef: '0.3',
        maxRef: '1.2',
        gender: 'Female',
        type: 'numeric',
        method: 'Diazonium Ion',
        machine: 'BECKMAN COULTER AU 5801',
        interpretation: 'Bilirubin is a yellowish pigment found in bile and is a breakdown product of normal heme catabolism. Elevated levels result from increased production, biliary obstruction, and hepatitis.'
      },
      { name: 'Serum Bilirubin, (Direct)', unit: 'mg/dl', minRef: '', maxRef: '0.2', gender: 'Female', type: 'numeric', method: 'Diazotization', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Bilirubin, (Indirect)', unit: 'mg/dl', minRef: '', maxRef: '0.8', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Aspartate Aminotransferase (AST/SGOT)', unit: 'U/L', minRef: '3.0', maxRef: '31', gender: 'Female', type: 'numeric', method: 'UV with P5P', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Alanine Aminotransferase (ALT/SGPT)', unit: 'U/L', minRef: '3', maxRef: '31', gender: 'Female', type: 'numeric', method: 'UV without P5P', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Alkaline Phosphatase (ALP)', unit: 'U/L', minRef: '33', maxRef: '98', gender: 'Female', type: 'numeric', method: 'IFCC AMP Buffer', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Gamma Glutamyl Transferase (GGT)', unit: 'U/L', minRef: '5', maxRef: '36', gender: 'Female', type: 'numeric', method: 'G-glutamyl-carboxy-IFCC', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Total Protein', unit: 'gm/dl', minRef: '6.6', maxRef: '8.3', gender: 'Female', type: 'numeric', method: 'Biuret', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Albumin', unit: 'g/dl', minRef: '3.5', maxRef: '5.2', gender: 'Female', type: 'numeric', method: 'Bromo Cresol Green(BCG)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Globulin', unit: 'gm/dl', minRef: '3', maxRef: '4.2', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Albumin/Globulin Ratio', unit: 'Ratio', minRef: '1.2', maxRef: '2.5', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'SGOT/SGPT Ratio', unit: 'Ratio', minRef: '0.7', maxRef: '1.4', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },
  {
    testName: 'Liver Function Test (LFT)',
    gender: 'Male',
    parameters: [
      {
        name: 'Serum Bilirubin, (Total)',
        unit: 'mg/dl',
        minRef: '0.3',
        maxRef: '1.2',
        gender: 'Male',
        type: 'numeric',
        method: 'Diazonium Ion',
        machine: 'BECKMAN COULTER AU 5801',
        interpretation: 'Bilirubin is a yellowish pigment found in bile and is a breakdown product of normal heme catabolism. Elevated levels result from increased production, biliary obstruction, and hepatitis.'
      },
      { name: 'Serum Bilirubin, (Direct)', unit: 'mg/dl', minRef: '', maxRef: '0.2', gender: 'Male', type: 'numeric', method: 'Diazotization', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Bilirubin, (Indirect)', unit: 'mg/dl', minRef: '', maxRef: '0.8', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Aspartate Aminotransferase (AST/SGOT)', unit: 'U/L', minRef: '3.0', maxRef: '35', gender: 'Male', type: 'numeric', method: 'UV with P5P', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Alanine Aminotransferase (ALT/SGPT)', unit: 'U/L', minRef: '3', maxRef: '35', gender: 'Male', type: 'numeric', method: 'UV without P5P', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Alkaline Phosphatase (ALP)', unit: 'U/L', minRef: '33', maxRef: '98', gender: 'Male', type: 'numeric', method: 'IFCC AMP Buffer', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Gamma Glutamyl Transferase (GGT)', unit: 'U/L', minRef: '8', maxRef: '61', gender: 'Male', type: 'numeric', method: 'G-glutamyl-carboxy-IFCC', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Total Protein', unit: 'gm/dl', minRef: '6.6', maxRef: '8.3', gender: 'Male', type: 'numeric', method: 'Biuret', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Albumin', unit: 'g/dl', minRef: '3.5', maxRef: '5.2', gender: 'Male', type: 'numeric', method: 'Bromo Cresol Green(BCG)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Globulin', unit: 'gm/dl', minRef: '3', maxRef: '4.2', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Albumin/Globulin Ratio', unit: 'Ratio', minRef: '1.2', maxRef: '2.5', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'SGOT/SGPT Ratio', unit: 'Ratio', minRef: '0.7', maxRef: '1.4', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },

  // =========================================================================
  // 3. KIDNEY FUNCTION TEST ADVANCE (KFT) - FEMALE & MALE
  // =========================================================================
  {
    testName: 'Kidney Function Test Advance (KFT)',
    gender: 'Female',
    parameters: [
      {
        name: 'Serum Creatinine',
        unit: 'mg/dl',
        minRef: '0.5',
        maxRef: '1.1',
        gender: 'Female',
        type: 'numeric',
        method: 'Jaffes Kinetic',
        machine: 'BECKMAN COULTER AU 5801',
        interpretation: 'Assessment of renal function is vital in identifying the presence of renal disease. Creatinine is a metabolic product of muscle catabolism, making its clearance rate a primary marker of glomerular filtration.'
      },
      { name: 'GFR, ESTIMATED', unit: 'mL/min/1.73m2', minRef: '90', maxRef: '150', gender: 'Female', type: 'numeric', method: 'Calculated (CKD-EPI)', machine: 'Calculated' },
      { name: 'Serum Uric Acid', unit: 'mg/dl', minRef: '2.6', maxRef: '6.0', gender: 'Female', type: 'numeric', method: 'Uricase', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Calcium', unit: 'mg/dl', minRef: '8.8', maxRef: '10.6', gender: 'Female', type: 'numeric', method: 'Arsenazo III', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Phosphorus', unit: 'mg/dl', minRef: '2.5', maxRef: '4.5', gender: 'Female', type: 'numeric', method: 'Phosphomolybdate', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Sodium', unit: 'mmol/L', minRef: '136', maxRef: '146', gender: 'Female', type: 'numeric', method: 'ISE (Indirect)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Chloride', unit: 'mmol/L', minRef: '101', maxRef: '109', gender: 'Female', type: 'numeric', method: 'ISE (Indirect)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Blood Urea', unit: 'mg/dl', minRef: '15', maxRef: '40', gender: 'Female', type: 'numeric', method: 'Urease', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Blood Urea Nitrogen (BUN)', unit: 'mg/dl', minRef: '7', maxRef: '18', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Bun/Creatinine Ratio', unit: 'Ratio', minRef: '10', maxRef: '20', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Urea/Creatinine Ratio', unit: 'Ratio', minRef: '20', maxRef: '30', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },
  {
    testName: 'Kidney Function Test Advance (KFT)',
    gender: 'Male',
    parameters: [
      {
        name: 'Serum Creatinine',
        unit: 'mg/dl',
        minRef: '0.7',
        maxRef: '1.3',
        gender: 'Male',
        type: 'numeric',
        method: 'Jaffes Kinetic',
        machine: 'BECKMAN COULTER AU 5801',
        interpretation: 'Assessment of renal function is vital in identifying the presence of renal disease. Creatinine is a metabolic product of muscle catabolism, making its clearance rate a primary marker of glomerular filtration.'
      },
      { name: 'GFR, ESTIMATED', unit: 'mL/min/1.73m2', minRef: '90', maxRef: '150', gender: 'Male', type: 'numeric', method: 'Calculated (CKD-EPI)', machine: 'Calculated' },
      { name: 'Serum Uric Acid', unit: 'mg/dl', minRef: '3.5', maxRef: '7.2', gender: 'Male', type: 'numeric', method: 'Uricase', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Calcium', unit: 'mg/dl', minRef: '8.8', maxRef: '10.6', gender: 'Male', type: 'numeric', method: 'Arsenazo III', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Phosphorus', unit: 'mg/dl', minRef: '2.5', maxRef: '4.5', gender: 'Male', type: 'numeric', method: 'Phosphomolybdate', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Sodium', unit: 'mmol/L', minRef: '136', maxRef: '146', gender: 'Male', type: 'numeric', method: 'ISE (Indirect)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum Chloride', unit: 'mmol/L', minRef: '101', maxRef: '109', gender: 'Male', type: 'numeric', method: 'ISE (Indirect)', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Blood Urea', unit: 'mg/dl', minRef: '17', maxRef: '43', gender: 'Male', type: 'numeric', method: 'Urease', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Blood Urea Nitrogen (BUN)', unit: 'mg/dl', minRef: '8', maxRef: '20', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Bun/Creatinine Ratio', unit: 'Ratio', minRef: '10', maxRef: '20', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Urea/Creatinine Ratio', unit: 'Ratio', minRef: '20', maxRef: '30', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },

  // =========================================================================
  // 4. LIPID PROFILE - FEMALE & MALE
  // =========================================================================
  {
    testName: 'Lipid Profile',
    gender: 'Female',
    parameters: [
      {
        name: 'Total Cholesterol',
        unit: 'mg/dL',
        minRef: '100',
        maxRef: '200',
        gender: 'Female',
        type: 'numeric',
        method: 'Cholesterol Oxidase',
        machine: 'BECKMAN COULTER AU 5801',
        interpretation: 'Dyslipidemia is a metabolic lipid disorder. High-Density Lipoprotein (HDL) carries protective benefits against Coronary Heart Disease.'
      },
      { name: 'Serum Triglycerides', unit: 'mg/dl', minRef: '50', maxRef: '150', gender: 'Female', type: 'numeric', method: 'Enzymatic', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum HDL Cholesterol', unit: 'mg/dl', minRef: '50', maxRef: '70', gender: 'Female', type: 'numeric', method: 'Direct measure', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'LDL Cholesterol', unit: 'mg/dl', minRef: '50', maxRef: '100', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'VLDL Cholesterol', unit: 'mg/dl', minRef: '5', maxRef: '30', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Total CHOL / HDL Cholesterol Ratio', unit: 'Ratio', minRef: '3.0', maxRef: '4.0', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'LDL / HDL Cholesterol Ratio', unit: 'Ratio', minRef: '0.5', maxRef: '2.5', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'HDL / LDL Cholesterol Ratio', unit: 'Ratio', minRef: '0.4', maxRef: '1.2', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Non-HDL Cholesterol', unit: 'mg/dl', minRef: '', maxRef: '150', gender: 'Female', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },
  {
    testName: 'Lipid Profile',
    gender: 'Male',
    parameters: [
      {
        name: 'Total Cholesterol',
        unit: 'mg/dL',
        minRef: '100',
        maxRef: '200',
        gender: 'Male',
        type: 'numeric',
        method: 'Cholesterol Oxidase',
        machine: 'BECKMAN COULTER AU 5801',
        interpretation: 'Dyslipidemia is a metabolic lipid disorder. High-Density Lipoprotein (HDL) carries protective benefits against Coronary Heart Disease.'
      },
      { name: 'Serum Triglycerides', unit: 'mg/dl', minRef: '50', maxRef: '150', gender: 'Male', type: 'numeric', method: 'Enzymatic', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Serum HDL Cholesterol', unit: 'mg/dl', minRef: '40', maxRef: '60', gender: 'Male', type: 'numeric', method: 'Direct measure', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'LDL Cholesterol', unit: 'mg/dl', minRef: '50', maxRef: '100', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'VLDL Cholesterol', unit: 'mg/dl', minRef: '5', maxRef: '30', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'BECKMAN COULTER AU 5801' },
      { name: 'Total CHOL / HDL Cholesterol Ratio', unit: 'Ratio', minRef: '3.3', maxRef: '4.4', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'LDL / HDL Cholesterol Ratio', unit: 'Ratio', minRef: '0.5', maxRef: '3.0', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'HDL / LDL Cholesterol Ratio', unit: 'Ratio', minRef: '0.4', maxRef: '1.0', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' },
      { name: 'Non-HDL Cholesterol', unit: 'mg/dl', minRef: '', maxRef: '160', gender: 'Male', type: 'numeric', method: 'Calculated', machine: 'Calculated' }
    ]
  },

  // =========================================================================
  // 5. URINE ROUTINE & MICROSCOPY EXTENDED - COMMON TO BOTH
  // =========================================================================
  {
    testName: 'Urine Routine & Microscopy Extended',
    gender: 'Both',
    parameters: [
      {
        name: 'Colour',
        unit: '',
        minRef: 'Pale Yellow',
        maxRef: '',
        gender: 'Both',
        type: 'numeric',
        method: 'Visual',
        machine: 'Visual Examination',
        interpretation: 'Urinalysis serves as a critical screening tool for renal, metabolic, and systemic disorders. Specific gravity evaluates kidney concentration capacity.'
      },
      { name: 'Volume', unit: 'mL', minRef: '10', maxRef: '', gender: 'Both', type: 'numeric', method: 'Visual', machine: 'Visual Examination' },
      { name: 'Appearance', unit: '', minRef: 'Clear', maxRef: '', gender: 'Both', type: 'numeric', method: 'Visual', machine: 'Visual Examination' },
      { name: 'Specific Gravity', unit: '', minRef: '1.001', maxRef: '1.035', gender: 'Both', type: 'numeric', method: 'Urometer', machine: 'Dipstick' },
      { name: 'pH', unit: '', minRef: '4.5', maxRef: '7.5', gender: 'Both', type: 'numeric', method: 'Double indicator', machine: 'Double indicator' },
      { name: 'Urine Protein', unit: '', minRef: 'Negative', maxRef: '', gender: 'Both', type: 'numeric', method: 'Dipstick', machine: 'Dipstick' },
      { name: 'Nitrite', unit: '', minRef: 'Negative', maxRef: '', gender: 'Both', type: 'numeric', method: 'Dipstick', machine: 'Dipstick' },
      { name: 'Pus Cells', unit: '/HPF', minRef: '', maxRef: '5', gender: 'Both', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' },
      { name: 'Epithelial cells', unit: '/HPF', minRef: '', maxRef: '5', gender: 'Both', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' },
      { name: 'RBCs', unit: '/HPF', minRef: 'Nil', maxRef: '', gender: 'Both', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' },
      { name: 'Casts', unit: '', minRef: 'Nil', maxRef: '', gender: 'Both', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' },
      { name: 'Crystals', unit: '', minRef: 'Nil', maxRef: '', gender: 'Both', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' },
      { name: 'Bacteria', unit: '', minRef: 'Absent', maxRef: '', gender: 'Both', type: 'numeric', method: 'Microscopic', machine: 'Microscopic' }
    ]
  }
];

const seedAll = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB for Complete Catalog Seeding...");

    // 1. Drop old single index if still present
    try {
      await MasterReportTemplate.collection.dropIndex("testName_1");
      console.log("Dropped legacy single index: testName_1");
    } catch (e) {
      console.log("Legacy index not found or already dropped.");
    }

    // 2. Ensure Compound Unique Index exists
    await MasterReportTemplate.collection.createIndex({ testName: 1, gender: 1 }, { unique: true });
    console.log("Verified compound index: { testName: 1, gender: 1 }");

    // 3. Remove old versions of these 5 tests
    const testNamesList = [
      'Complete Blood Count (CBC)',
      'Liver Function Test (LFT)',
      'Kidney Function Test Advance (KFT)',
      'Lipid Profile',
      'Urine Routine & Microscopy Extended'
    ];
    await MasterReportTemplate.deleteMany({ testName: { $in: testNamesList } });

    // 4. Insert all 9 documents (4 pairs of Male/Female + 1 Both)
    await MasterReportTemplate.insertMany(fullCatalogTemplates);
    console.log("✅ Successfully seeded all 9 gender-specific documents into masterreporttemplates collection!");

    const totalCount = await MasterReportTemplate.countDocuments();
    console.log(`Total master templates in database: ${totalCount}`);

    process.exit(0);
  } catch (err) {
    console.error("Seeding Error:", err);
    process.exit(1);
  }
};

seedAll();