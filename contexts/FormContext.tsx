"use client"
import { createContext, useContext, useState, ReactNode } from 'react';

// Define types
interface FormData {
  name: string;
  age: string;
  email: string;
  phoneNumber: string;
}

interface FormErrors {
  name?: string;
  age?: string;
  email?: string;
  phoneNumber?: string;
}

interface FormContextType {
  formData: FormData;
  displayData: FormData;
  errors: FormErrors;
  updateField: (field: keyof FormData, value: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  handleReset: () => void;
}

// Create context
const FormContext = createContext<FormContextType | undefined>(undefined);

// Provider component
export function FormProvider({ children }: { children: ReactNode }) {
  const [formData, setFormData] = useState<FormData>({
    name: "",
    age: "",
    email: "",
    phoneNumber: "",
  });

  const [displayData, setDisplayData] = useState<FormData>({
    name: "",
    age: "",
    email: "",
    phoneNumber: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});

  const updateField = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors: FormErrors = {};


    if (!formData.name || formData.name.trim() === "") {
      validationErrors.name = "Name is required";
    }


    if (formData.age && (formData.age.trim() === "" || formData.age.length !== 2 || Number(formData.age) > 60 || !/^[0-9]+$/.test(formData.age))) {
      validationErrors.age = "Age is not valid";
    }


    if (!formData.email || formData.email.trim() === "" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      validationErrors.email = "Email is not valid";
    }
    if (!formData.phoneNumber || formData.phoneNumber.trim() === "" || formData.phoneNumber.length !== 10 || !/^[0-9]+$/.test(formData.phoneNumber)) {
      validationErrors.phoneNumber = "Phone number is not valid";
    }

    setErrors(validationErrors);

    if (Object.keys(validationErrors).length === 0) {
      console.log(formData, "formdata");
      setDisplayData(formData);
      console.log(formData, "displayData");
    }
  };

  const handleReset = () => {
    setFormData({
      name: "",
      age: "",
      email: "",
      phoneNumber: "",
    });
    setErrors({});
    setDisplayData({
      name: "",
      age: "",
      email: "",
      phoneNumber: "",
    });
  };

  return (
    <FormContext.Provider value={{
      formData,
      displayData,
      errors,
      updateField,
      handleSubmit,
      handleReset,
    }}>
      {children}
    </FormContext.Provider>
  );
}

// Custom hook to use the form context
export function useForm() {
  const context = useContext(FormContext);
  if (context === undefined) {
    throw new Error('useForm must be used within a FormProvider');
  }
  return context;
}
