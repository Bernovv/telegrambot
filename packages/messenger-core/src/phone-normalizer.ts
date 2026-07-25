import type { PhoneNormalizer } from "@ticket-platform/application";
import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode
} from "libphonenumber-js/max";

export class InvalidPhoneNumberError extends Error {
  constructor() {
    super("Phone number is invalid");
    this.name = "InvalidPhoneNumberError";
  }
}

export class LibPhoneNumberNormalizer implements PhoneNormalizer {
  private readonly defaultCountry: CountryCode;

  constructor(defaultCountry = "RU") {
    if (!isSupportedCountry(defaultCountry)) {
      throw new Error("Default phone country is not supported");
    }

    this.defaultCountry = defaultCountry;
  }

  normalize(rawPhone: string): string {
    const phone = parsePhoneNumberFromString(rawPhone, {
      defaultCountry: this.defaultCountry,
      extract: false
    });

    if (!phone?.isValid()) {
      throw new InvalidPhoneNumberError();
    }

    return phone.number;
  }
}
