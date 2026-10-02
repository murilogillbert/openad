import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ProfileSecurityPage } from './profile-security.page';

describe('ProfileSecurityPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfileSecurityPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('creates', () => {
    const fixture = TestBed.createComponent(ProfileSecurityPage);
    expect(fixture.componentInstance).toBeTruthy();
  });
});

