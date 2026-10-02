import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { PlatformConfigPage } from './platform-config.page';

describe('PlatformConfigPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlatformConfigPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('creates', () => {
    const fixture = TestBed.createComponent(PlatformConfigPage);
    expect(fixture.componentInstance).toBeTruthy();
  });
});

